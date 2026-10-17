//! Local HTTP server for the Xbox Game Bar widget (`widget/`), which is a separate UWP
//! package and can't use Tauri IPC. It serves the HUD page (`/?hud=1`) from the bundled
//! frontend and exposes only the HUD commands as `POST /api/<command>`.
use std::{io::Read, path::PathBuf};
use tauri::Manager;
use tiny_http::{Header, Method, Request, Response, Server};

/// Fixed so the widget can find Sofa without discovery.
pub const PORT: u16 = 47811;

/// Where the built frontend lives: bundled resource in production, `../dist` in dev.
fn dist_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resources = app.path().resource_dir().ok();
    [
        resources.as_ref().map(|r| r.join("_up_").join("dist")),
        resources.as_ref().map(|r| r.join("dist")),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")),
    ]
    .into_iter()
    .flatten()
    .find(|p| p.join("index.html").is_file())
}

fn mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn json(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
}

/// The widget loads bundled assets and media, but never remote scripts.
const HUD_CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; media-src 'self' https: blob:; connect-src 'self' https:";

fn trusted_widget_headers(origin: Option<&str>, host: Option<&str>, content_type: Option<&str>) -> bool {
    let expected_origin = format!("http://127.0.0.1:{PORT}");
    let expected_host = format!("127.0.0.1:{PORT}");
    origin == Some(expected_origin.as_str())
        && host == Some(expected_host.as_str())
        && content_type.is_some_and(|value| value.starts_with("application/json"))
}

fn trusted_widget_request(request: &Request) -> bool {
    let origin = request.headers().iter().find(|h| h.field.equiv("Origin")).map(|h| h.value.as_str());
    let host = request.headers().iter().find(|h| h.field.equiv("Host")).map(|h| h.value.as_str());
    let content_type = request.headers().iter().find(|h| h.field.equiv("Content-Type")).map(|h| h.value.as_str());
    trusted_widget_headers(origin, host, content_type)
}

/// Runs one HUD command. Same functions the Tauri commands use; only this allowlist is reachable.
async fn dispatch(app: &tauri::AppHandle, command: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    use crate::{ally, ally_pad, audio, display, game_settings, hud, power, quit, rtss, session, stats};
    fn parse<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, String> {
        serde_json::from_value(value).map_err(|_| "invalidInput".to_string())
    }
    fn out(value: impl serde::Serialize) -> Result<serde_json::Value, String> {
        serde_json::to_value(value).map_err(|_| "invalidResponse".to_string())
    }
    let arg = |name: &str| args.get(name).cloned().unwrap_or(serde_json::Value::Null);
    match command {
        "current_session" => out(session::current_session(app.clone(), app.state()).await?),
        "running_game" => out(quit::running_game(app.clone()).await?),
        "game_stats" => out(stats::game_stats().await),
        // The widget page reports once that it loaded and which way controller input reaches it.
        "hud_input" => {
            let path: String = parse(arg("path"))?;
            if ["ready", "bridge", "keys"].contains(&path.as_str()) {
                crate::log::info(app, format!("hud: widget {path}"));
            }
            out(())
        }
        "close_game" => out(quit::close_game(parse(arg("force"))?, app.clone()).await?),
        "power_status" => out(power::power_status().await?),
        "ally_status" => out(ally::ally_status(app.clone(), app.state()).await?),
        "set_fan_curve" => out(ally::set_fan_curve(parse(arg("preset"))?, app.clone()).await?),
        "set_controller_lighting" => out(ally_pad::set_controller_lighting(parse(arg("on"))?, app.state()).await?),
        "set_controller_mode" => out(ally_pad::set_controller_mode(parse(arg("mouse"))?, app.state()).await?),
        "builtin_controller" => out(ally_pad::builtin_controller(app.clone()).await),
        "set_builtin_controller" => out(ally_pad::set_builtin_controller(parse(arg("enabled"))?, app.clone()).await?),
        "framerate_status" => out(rtss::framerate_status().await),
        "set_framerate_limit" => out(rtss::set_framerate_limit(parse(arg("fps"))?, app.clone()).await?),
        "set_auto_hdr" => out(display::set_auto_hdr(parse(arg("on"))?).await?),
        "language" => out(hud::language(app.clone()).await),
        "set_ally_profile" => out(ally::set_ally_profile(parse(arg("profile"))?).await?),
        "set_tdp" => out(ally::set_tdp(parse(arg("watts"))?).await?),
        "display_status" => out(display::display_status().await),
        "set_display_mode" => out(display::set_display_mode(parse(arg("mode"))?, app.clone()).await?),
        "set_brightness" => out(display::set_brightness(parse(arg("percent"))?).await?),
        "volume_status" => out(audio::volume_status().await),
        "set_volume" => out(audio::set_volume(parse(arg("percent"))?).await?),
        "set_cpu_boost" => out(display::set_cpu_boost(parse(arg("on"))?).await?),
        "game_settings" => out(game_settings::game_settings(parse(arg("id"))?, app.clone()).await),
        "set_game_settings" => out(
            game_settings::set_game_settings(parse(arg("id"))?, parse(arg("settings"))?, app.clone()).await?,
        ),
        _ => Err("invalidInput".into()),
    }
}

fn handle(app: &tauri::AppHandle, dist: Option<&PathBuf>, mut request: Request) {
    let url = request.url().to_owned();
    let path = url.split('?').next().unwrap_or("/");
    let response = if let Some(command) = path.strip_prefix("/api/") {
        if !trusted_widget_request(&request) || *request.method() != Method::Post {
            json(403, r#"{"error":"accessDenied"}"#.into())
        } else {
            let mut body = String::new();
            let _ = request.as_reader().take(64 * 1024).read_to_string(&mut body);
            let args: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
            match tauri::async_runtime::block_on(dispatch(app, command, args)) {
                Ok(value) => json(200, value.to_string()),
                Err(key) => json(400, serde_json::json!({ "error": key }).to_string()),
            }
        }
    } else {
        // Static files, with `/` → index.html. Reject path traversal.
        let relative = path.trim_start_matches('/');
        let file = dist.and_then(|d| {
            let clean = relative.is_empty() || !relative.split('/').any(|s| s == ".." || s.is_empty());
            clean.then(|| d.join(if relative.is_empty() { "index.html" } else { relative }))
        });
        match file.filter(|f| f.is_file()).and_then(|f| std::fs::read(&f).ok().map(|b| (f, b))) {
            Some((f, bytes)) => Response::from_data(bytes)
                .with_header(Header::from_bytes("Content-Type", mime(&f)).unwrap())
                .with_header(Header::from_bytes("Content-Security-Policy", HUD_CSP).unwrap()),
            None => Response::from_data(b"not found".to_vec()).with_status_code(404),
        }
    };
    let _ = request.respond(response);
}

/// Starts the server on 127.0.0.1 only; silently skips if the port is taken (another Sofa).
pub fn start(app: tauri::AppHandle) {
    let Ok(server) = Server::http(("127.0.0.1", PORT)) else { return };
    let dist = dist_dir(&app);
    std::thread::spawn(move || {
        for request in server.incoming_requests() {
            handle(&app, dist.as_ref(), request);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_api_rejects_missing_or_lookalike_origins() {
        let origin = format!("http://127.0.0.1:{PORT}");
        let host = format!("127.0.0.1:{PORT}");
        assert!(trusted_widget_headers(Some(&origin), Some(&host), Some("application/json")));
        assert!(!trusted_widget_headers(None, Some(&host), Some("application/json")));
        assert!(!trusted_widget_headers(Some(&format!("{origin}.evil.test")), Some(&host), Some("application/json")));
        assert!(!trusted_widget_headers(Some(&origin), Some("localhost:47811"), Some("application/json")));
        assert!(!trusted_widget_headers(Some(&origin), Some(&host), Some("text/plain")));
    }
}

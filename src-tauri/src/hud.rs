use tauri::Manager;
#[cfg(not(windows))]
use tauri::{WebviewUrl, WebviewWindowBuilder};
/// The Game Bar widget runs on another origin and can't see the library's localStorage,
/// so the chosen language is kept in `language.txt` (app data dir) for it.
const LANGUAGES: [&str; 3] = ["en", "pt-BR", "es"];

fn language_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("language.txt"))
}

#[tauri::command]
pub async fn language(app: tauri::AppHandle) -> Option<String> {
    let saved = std::fs::read_to_string(language_file(&app)?).ok()?;
    let saved = saved.trim();
    LANGUAGES.contains(&saved).then(|| saved.to_owned())
}

#[tauri::command]
pub async fn set_language(lang: String, app: tauri::AppHandle) -> Result<(), String> {
    if !LANGUAGES.contains(&lang.as_str()) {
        return Err("invalidInput".into());
    }
    let path = language_file(&app).ok_or("serviceUnavailable")?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(path, lang).map_err(|_| "serviceUnavailable".into())
}

#[cfg(windows)]
fn show_hud(app: &tauri::AppHandle) -> Result<(), String> {
    crate::widget::open_game_bar(app)
}

// Desktop preview only. In Windows games, Game Bar owns the overlay surface.
#[cfg(not(windows))]
fn show_hud(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("hud") {
        window.show().map_err(|_| "openFailed")?;
        window.set_focus().map_err(|_| "openFailed")?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "hud", WebviewUrl::App("index.html?hud=1".into()))
        .title("Sofa HUD")
        .inner_size(460.0, 640.0)
        .position(24.0, 24.0)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|_| "openFailed")?
        .set_focus()
        .map_err(|_| "openFailed")?;
    Ok(())
}

#[tauri::command]
pub async fn open_hud(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || show_hud(&app))
        .await.map_err(|_| "openFailed")?
}

/// The Xbox button of any XInput controller opens Game Bar, as on an Xbox controller.
/// The Ally Command Center button is handled separately by `ally_input`.
#[cfg(windows)]
pub fn watch_controller(app: tauri::AppHandle) {
    use windows_sys::Win32::UI::Input::XboxController::*;
    let Some(get_state) = state_with_guide() else {
        crate::log::info(&app, "hud: XInputGetStateEx unavailable; Xbox button not watched");
        return;
    };
    std::thread::spawn(move || {
        let mut connected = [true; 4];
        let mut was_held = false;
        let mut tick = 0u32;
        loop {
            // Wraps instead of overflowing; only multiples of 40 matter.
            tick = tick.wrapping_add(1);
            std::thread::sleep(std::time::Duration::from_millis(50));
            let mut held = false;
            for (index, live) in connected.iter_mut().enumerate() {
                // Polling empty slots is slow in XInput; probe them every 2 s only.
                if !*live && !tick.is_multiple_of(40) {
                    continue;
                }
                let mut state = XINPUT_STATE::default();
                *live = unsafe { get_state(index as u32, &mut state) } == 0;
                held |= *live && state.Gamepad.wButtons & GUIDE != 0;
            }
            if held && !was_held {
                guide_pressed(&app);
            }
            was_held = held;
        }
    });
}

/// The Xbox button's bit; only `XInputGetStateEx` reports it.
#[cfg(windows)]
const GUIDE: u16 = 0x0400;

#[cfg(windows)]
type GetState = unsafe extern "system" fn(u32, *mut windows_sys::Win32::UI::Input::XboxController::XINPUT_STATE) -> u32;

/// `XInputGetStateEx`: `XInputGetState` plus the Xbox button. Undocumented, exported by
/// ordinal 100 only (Steam and DS4Windows read the button the same way).
#[cfg(windows)]
fn state_with_guide() -> Option<GetState> {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    let dll: Vec<u16> = "xinput1_4.dll\0".encode_utf16().collect();
    // Null-terminated name; the module is never freed, so the returned pointer stays valid.
    let module = unsafe { LoadLibraryW(dll.as_ptr()) };
    if module.is_null() {
        return None;
    }
    // An ordinal travels in the low word of the name pointer.
    let f = unsafe { GetProcAddress(module, std::ptr::without_provenance(100)) }?;
    // DWORD XInputGetStateEx(DWORD, XINPUT_STATE*), same signature as XInputGetState.
    Some(unsafe { std::mem::transmute::<unsafe extern "system" fn() -> isize, GetState>(f) })
}

/// Windows already opens Game Bar for Xbox controllers but not for every XInput pad. Wait and
/// see: if Game Bar didn't come or go on its own, Windows ignored the press and Sofa toggles it;
/// a second Win+G after Windows' own would undo it.
/// ponytail: fixed 600 ms wait; a cold Game Bar start slower than that still toggles twice.
/// Watch for Game Bar's window instead if the log shows it.
#[cfg(windows)]
fn guide_pressed(app: &tauri::AppHandle) {
    if !controller_opens_game_bar() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let before = game_bar_in_front();
        std::thread::sleep(std::time::Duration::from_millis(600));
        let after = game_bar_in_front();
        crate::log::info(&app, format!("hud: Xbox button, Game Bar in front {before} -> {after}"));
        if before == after
            && let Err(error) = show_hud(&app) {
                crate::log::info(&app, format!("hud: Game Bar launch failed: {error}"));
            }
    });
}

#[cfg(windows)]
fn game_bar_in_front() -> bool {
    crate::foreground().is_some_and(|(exe, _)| exe.eq_ignore_ascii_case("GameBar.exe"))
}

/// Settings > Gaming > Game Bar, "Open Game Bar using this button on a controller"; on unless
/// the player turned it off.
#[cfg(windows)]
fn controller_opens_game_bar() -> bool {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\GameBar")
        .and_then(|k| k.get_value::<u32, _>("UseNexusForGameBarEnabled"))
        .ok()
        .is_none_or(|on| on != 0)
}

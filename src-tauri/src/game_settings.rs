//! Per-game quick settings (power profile, display mode, brightness), saved from the HUD and
//! applied by `launch` before the game starts, then restored after the game exits. Stored in
//! `game-settings.json` (app data dir)
//! because the HUD runs in other windows and origins than the library.
use crate::{ally::AllyProfile, display::Mode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct GameSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<AllyProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<Mode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brightness: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tdp: Option<u8>,
}

type Store = HashMap<String, GameSettings>;

#[derive(Serialize, Deserialize)]
struct ActiveSession {
    id: String,
    baseline: GameSettings,
}

static WATCHING: AtomicBool = AtomicBool::new(false);

fn session_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("game-settings-active.json"))
}

fn active(app: &tauri::AppHandle) -> Option<ActiveSession> {
    session_file(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("game-settings.json"))
}

fn load(app: &tauri::AppHandle) -> Store {
    file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn get(app: &tauri::AppHandle, id: &str) -> Option<GameSettings> {
    load(app).remove(id)
}

#[tauri::command]
pub async fn game_settings(id: String, app: tauri::AppHandle) -> Option<GameSettings> {
    get(&app, &id)
}

/// `settings: null` forgets the game.
#[tauri::command]
pub async fn set_game_settings(
    id: String,
    settings: Option<GameSettings>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if crate::library::steam_app_id(&id).is_none() && !id.starts_with("epic:") && !id.starts_with("gog:") && !id.starts_with("xbox:") {
        return Err("invalidInput".into());
    }
    let mut store = load(&app);
    match settings {
        Some(s) => drop(store.insert(id, s)),
        None => drop(store.remove(&id)),
    }
    let path = file(&app).ok_or("serviceUnavailable")?;
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let json = serde_json::to_vec(&store).map_err(|_| "serviceUnavailable")?;
    std::fs::write(path, json).map_err(|_| "serviceUnavailable".to_string())
}

/// Applies a game's saved settings only when the previous values can be read and persisted.
/// A prior active session keeps ownership of its baseline until it has been restored.
pub async fn apply(app: &tauri::AppHandle, id: &str) -> bool {
    let Some(s) = get(app, id) else { return false };
    if active(app).is_some() { return false }
    let display = crate::display::display_status().await;
    let baseline = GameSettings {
        profile: if s.profile.is_some() { crate::ally::current_profile().await } else { None },
        tdp: if s.tdp.is_some() { crate::ally::current_tdp().await } else { None },
        mode: if s.mode.is_some() { display.current } else { None },
        brightness: if s.brightness.is_some() { display.brightness } else { None },
    };
    if baseline.profile.is_none() && baseline.tdp.is_none() && baseline.mode.is_none() && baseline.brightness.is_none() {
        return false;
    }
    let Some(path) = session_file(app) else { return false };
    if let Some(dir) = path.parent() && std::fs::create_dir_all(dir).is_err() { return false }
    let session = ActiveSession { id: id.to_owned(), baseline: baseline.clone() };
    if serde_json::to_vec(&session).ok().and_then(|json| std::fs::write(&path, json).ok()).is_none() { return false }
    crate::log::info(app, format!("launch: applying saved settings for {id}"));
    if let Some(profile) = s.profile.filter(|_| baseline.profile.is_some())
        && let Err(e) = crate::ally::set_ally_profile(profile).await {
            crate::log::info(app, format!("launch: profile failed: {e}"));
        }
    if let Some(watts) = s.tdp.filter(|_| baseline.tdp.is_some())
        && let Err(e) = crate::ally::set_tdp(watts).await {
            crate::log::info(app, format!("launch: tdp failed: {e}"));
        }
    if let Some(mode) = s.mode.filter(|_| baseline.mode.is_some())
        && let Err(e) = crate::display::set_display_mode(mode, app.clone()).await {
            crate::log::info(app, format!("launch: display mode failed: {e}"));
        }
    if let Some(percent) = s.brightness.filter(|_| baseline.brightness.is_some())
        && let Err(e) = crate::display::set_brightness(percent).await {
            crate::log::info(app, format!("launch: brightness failed: {e}"));
        }
    true
}

pub async fn restore(app: &tauri::AppHandle) {
    let Some(session) = active(app) else { return };
    let s = session.baseline;
    crate::log::info(app, format!("launch: restoring settings after {}", session.id));
    let mut ok = true;
    if let Some(profile) = s.profile { ok &= crate::ally::set_ally_profile(profile).await.is_ok(); }
    if let Some(tdp) = s.tdp { ok &= crate::ally::set_tdp(tdp).await.is_ok(); }
    if let Some(mode) = s.mode { ok &= crate::display::set_display_mode(mode, app.clone()).await.is_ok(); }
    if let Some(brightness) = s.brightness { ok &= crate::display::set_brightness(brightness).await.is_ok(); }
    if ok {
        if let Some(path) = session_file(app) { let _ = std::fs::remove_file(path); }
    } else {
        crate::log::info(app, "launch: settings restore failed; will retry".to_owned());
    }
}

/// On restart an on-disk baseline is recovered. A launch must become observable within two
/// minutes; after that, or three missed polls following observation, restore and retry failures.
pub fn watch(app: tauri::AppHandle) {
    if active(&app).is_none() || WATCHING.swap(true, Ordering::AcqRel) { return }
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let mut observed = false;
        let mut missed = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let Some(session) = active(&app) else { break };
            let check_app = app.clone();
            let running = tauri::async_runtime::spawn_blocking(move || crate::quit::is_running_id(&check_app, &session.id)).await.unwrap_or(false);
            if running { observed = true; missed = 0; continue }
            missed += 1;
            if (observed && missed >= 3) || (!observed && started.elapsed() >= Duration::from_secs(120)) {
                restore(&app).await;
                if active(&app).is_none() { break }
            }
        }
        WATCHING.store(false, Ordering::Release);
    });
}

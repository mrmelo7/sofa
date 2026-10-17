mod library;
mod uninstall;
mod epic_uninstall;
mod steam_uninstall;
mod categories;
mod network;
mod store;
mod hud;
mod power;
mod accounts;
mod epic;
mod ally;
mod ally_pad;
mod rtss;
mod storage;
mod apps;
mod sizes;
#[cfg(any(windows, test))]
mod ally_input;
mod display;
mod audio;
mod bluetooth;
mod xbox_mode;
mod hud_server;
mod session;
mod log;
mod game_settings;
mod quit;
mod stats;
mod widget;
mod xbox_library;

use tauri::Manager;

/// Launchers that raise their own window when asked to start a game.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_launcher(exe: &str) -> bool {
    const LAUNCHERS: [&str; 9] = [
        "steam.exe",
        "steamwebhelper.exe",
        "epicgameslauncher.exe",
        "epicwebhelper.exe",
        "galaxyclient.exe",
        "eadesktop.exe",
        "upc.exe",
        "battle.net.exe",
        "ubisoftconnect.exe",
    ];
    LAUNCHERS.contains(&exe.to_ascii_lowercase().as_str())
}

/// File name of the process that owns the foreground window, and that window.
#[cfg(windows)]
pub(crate) fn foreground() -> Option<(String, windows_sys::Win32::Foundation::HWND)> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    // No arguments; returns null when nothing has the foreground.
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return None;
    }
    let mut pid = 0u32;
    // `hwnd` was just returned by Windows; `pid` outlives the call.
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == std::process::id() {
        return Some(("sofa".into(), hwnd));
    }
    Some((process_name(pid)?, hwnd))
}

/// File name of process `pid`'s executable.
#[cfg(windows)]
fn process_name(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};
    // Query-only access to read the image name.
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut buffer = [0u16; 1024];
    let mut size = buffer.len() as u32;
    // Writes at most `size` UTF-16 units into `buffer` and updates `size`.
    let ok = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut size) };
    // Opened just above.
    unsafe { CloseHandle(process) };
    if ok == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buffer[..size as usize]);
    Some(path.rsplit('\\').next().unwrap_or_default().to_owned())
}

/// Opens a page of Windows Settings (`ms-settings:…`). When Settings is already open, Windows
/// switches the page but may leave the window behind Sofa; bring it to the front.
pub(crate) fn open_settings_page(app: &tauri::AppHandle, uri: &'static str) -> Result<(), String> {
    tauri_plugin_opener::open_url(uri, None::<&str>).map_err(|_| "openFailed")?;
    #[cfg(windows)]
    {
        let app = app.clone();
        std::thread::spawn(move || {
            for _ in 0..20 {
                std::thread::sleep(std::time::Duration::from_millis(150));
                if let Some(window) = settings_window() {
                    use windows_sys::Win32::UI::WindowsAndMessaging::{SW_RESTORE, SetForegroundWindow, ShowWindow};
                    // A top-level window Windows just enumerated; Sofa is in front, so it may hand
                    // the foreground over.
                    unsafe { ShowWindow(window, SW_RESTORE) };
                    let raised = unsafe { SetForegroundWindow(window) } != 0;
                    log::info(&app, format!("settings: {uri} brought to front: {raised}"));
                    return;
                }
            }
            log::info(&app, format!("settings: {uri} window not found"));
        });
    }
    #[cfg(not(windows))]
    let _ = app;
    Ok(())
}

/// The Settings app's frame: a UWP `ApplicationFrameWindow` whose content (`CoreWindow`)
/// belongs to SystemSettings.exe.
#[cfg(windows)]
fn settings_window() -> Option<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetWindowThreadProcessId};
    let frame_class: Vec<u16> = "ApplicationFrameWindow\0".encode_utf16().collect();
    let content_class: Vec<u16> = "Windows.UI.Core.CoreWindow\0".encode_utf16().collect();
    let mut frame = std::ptr::null_mut();
    loop {
        // Next top-level frame after `frame`; class names are null-terminated above.
        frame = unsafe { FindWindowExW(std::ptr::null_mut(), frame, frame_class.as_ptr(), std::ptr::null()) };
        if frame.is_null() {
            return None;
        }
        // The frame's content window, if it is attached.
        let content = unsafe { FindWindowExW(frame, std::ptr::null_mut(), content_class.as_ptr(), std::ptr::null()) };
        if content.is_null() {
            continue;
        }
        let mut pid = 0u32;
        // `content` was just returned by Windows; `pid` outlives the call.
        unsafe { GetWindowThreadProcessId(content, &mut pid) };
        if process_name(pid).is_some_and(|exe| exe.eq_ignore_ascii_case("SystemSettings.exe")) {
            return Some(frame);
        }
    }
}

/// After a launch request, the launcher (Steam, Epic…) jumps in front of Sofa. Push it down and
/// bring Sofa back until the game itself takes the foreground, so closing the game returns to
/// Sofa. Gives up after 90 s or as soon as anything else (the game, the user) is in front, and
/// then tells the launch screen with `launch-settled`; `launch-progress` says the launcher showed
/// up, so the screen can say it is preparing the game.
#[cfg(windows)]
pub(crate) fn keep_sofa_in_front(app: tauri::AppHandle) {
    use tauri::Emitter;
    use windows_sys::Win32::UI::WindowsAndMessaging::{SW_MINIMIZE, ShowWindow};
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let mut announced = false;
        while started.elapsed() < std::time::Duration::from_secs(90) {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let Some((exe, hwnd)) = foreground() else { continue };
            if exe == "sofa" {
                continue;
            }
            if !is_launcher(&exe) {
                log::info(&app, format!("launch: {exe} took the foreground"));
                break;
            }
            // The launcher's own window, just reported by Windows.
            unsafe { ShowWindow(hwnd, SW_MINIMIZE) };
            let _ = bring_to_front(&app);
        }
        let _ = app.emit("launch-settled", ());
    });
}
#[cfg(not(windows))]
fn keep_sofa_in_front(_app: tauri::AppHandle) {}

/// `System32\<name>` resolved through Windows, so nothing planted on PATH runs instead.
#[cfg(windows)]
pub(crate) fn system_exe(name: &str) -> Option<std::path::PathBuf> {
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buffer = [0u16; 32768];
    // Writes at most buffer.len() UTF-16 units and returns the length used.
    let length = unsafe { GetSystemDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
    (length != 0 && length < buffer.len())
        .then(|| std::path::PathBuf::from(String::from_utf16_lossy(&buffer[..length])).join(name))
}

#[tauri::command]
async fn scan_library(app: tauri::AppHandle) -> Vec<library::Game> {
    tauri::async_runtime::spawn_blocking(move || library::scan_with_custom(&app))
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn gog_owned_library() -> Vec<library::Game> {
    tauri::async_runtime::spawn_blocking(library::gog_owned).await.unwrap_or_default()
}

/// Steam download state of the installs Sofa requested; other stores report nothing.
#[tauri::command]
async fn install_progress(ids: Vec<String>) -> std::collections::HashMap<String, library::InstallProgress> {
    tauri::async_runtime::spawn_blocking(move || {
        ids.iter()
            .take(20)
            .filter_map(|id| library::steam_install_progress(id).map(|p| (id.clone(), p)))
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// WebView2 arguments for every window (they share one environment, which refuses windows
/// created with different ones). Wry's defaults, plus sound without a click: a gamepad press
/// isn't a user gesture, so interface sounds and trailers would stay silent otherwise. The main
/// window gets the same string from tauri.conf.json; a test keeps the two equal.
pub(crate) const WEBVIEW_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

pub(crate) fn bring_to_front(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("serviceUnavailable")?;
    let _ = window.unminimize();
    // Windows only hands the foreground to a topmost window reliably; drop it right after.
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    let _ = window.set_always_on_top(false);
    Ok(())
}

/// Brings Sofa back in front once the launcher no longer needs the user (download started).
#[tauri::command]
async fn focus_main(app: tauri::AppHandle) -> Result<(), String> {
    bring_to_front(&app)
}

/// Takes a game id, never a raw path: the webview can only start things the scan found.
/// Steam on Windows uses its executable; other launchers use the OS opener.
// ponytail: rescans per launch (ms on a normal library); cache in app state if it shows up.
#[tauri::command]
async fn launch(id: String, app: tauri::AppHandle) -> Result<(), String> {
    static LAUNCH_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    let _guard = LAUNCH_LOCK.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    let game_id = id.clone();
    let scan_app = app.clone();
    let game = tauri::async_runtime::spawn_blocking(move || {
        library::scan_with_custom(&scan_app).into_iter().find(|g| g.id == game_id)
    }).await.map_err(|_| "openFailed")?.ok_or("openFailed")?;
    let applied = if game.source != "custom" { game_settings::apply(&app, &id).await } else { false };
    log::info(&app, format!("launch: requesting {id}"));
    let launch_app = app.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        if game.source == "custom" {
            apps::launch_app(game.id, launch_app)
        } else {
            library::launch_game(&game)
        }
    }).await.unwrap_or_else(|_| Err("openFailed".into()));
    if let Err(error) = r {
        log::info(&app, format!("launch: {id} failed: {error}"));
        if applied {
            game_settings::restore(&app).await;
            game_settings::watch(app.clone());
        }
        return Err("openFailed".into());
    }
    log::info(&app, format!("launch: request dispatched for {id}"));
    if let Ok(mut last) = app.state::<quit::LastLaunch>().0.lock() {
        *last = Some(id);
    }
    if applied { game_settings::watch(app.clone()); }
    keep_sofa_in_front(app);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(uninstall::UninstallState::default())
        .manage(categories::CategoryCache::default())
        .manage(store::StoreCache::default())
        .manage(accounts::SteamLibrarySession::default())
        .manage(epic::EpicLibrarySession::default())
        .manage(ally_pad::PadState::default())
        .manage(bluetooth::Scan::default())
        .manage(apps::Browser::default())
        .manage(session::Playtime::default())
        .manage(quit::LastLaunch::default())
        .setup(|app| {
            #[cfg(windows)]
            {
                hud::watch_controller(app.handle().clone());
                ally_input::watch(app.handle().clone());
            }
            hud_server::start(app.handle().clone());
            session::watch(app.handle().clone());
            game_settings::watch(app.handle().clone());
            // Launched by the Xbox full screen experience (`--fse`, see packaging/AppxManifest.xml)
            // or opened while Xbox mode is on: Sofa is the console UI, so no window chrome.
            // Xbox mode re-lays out the window after activation; apply again once it settles.
            if std::env::args().any(|a| a == "--fse") || xbox_mode::active() == Some(true) {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    for delay in [0, 500, 2000] {
                        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.set_fullscreen(true);
                        }
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Focused(true)) {
                let app = window.app_handle().clone();
                std::thread::spawn(move || library::close_big_picture(&app));
            }
            #[cfg(not(windows))]
            let _ = (window, event);
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![scan_library, gog_owned_library, install_progress, focus_main, launch, uninstall::uninstall_game, categories::cached_categories, categories::game_categories, store::store_deals, store::store_upcoming, store::open_upcoming, store::store_shops, store::store_game, store::open_deal, store::steam_prices, store::usd_rate, store::store_similar, store::store_media, store::game_media, store::store_lookup, store::import_steam_wishlist, store::wishlist_prices, store::epic_free_games, store::open_epic_free, store::steam_tags, hud::open_hud, hud::language, hud::set_language, session::current_session, quit::running_game, quit::close_game, stats::game_stats, session::playtimes, log::open_log, storage::storage_status, storage::open_storage_settings, apps::apps_list, apps::browse, apps::browse_up, apps::add_app, apps::remove_app, apps::launch_app, sizes::game_size_estimate, game_settings::game_settings, game_settings::set_game_settings, power::power_status, power::perform_power, ally::ally_status, ally::set_ally_profile, ally::set_tdp, ally::set_fan_curve, ally_pad::set_controller_lighting, ally_pad::set_controller_mode, ally_pad::builtin_controller, ally_pad::set_builtin_controller, rtss::framerate_status, rtss::set_framerate_limit, display::set_auto_hdr, audio::volume_status, audio::set_volume, bluetooth::bluetooth_scan, bluetooth::bluetooth_pair, bluetooth::bluetooth_paired, bluetooth::bluetooth_unpair, power::identify_controller, bluetooth::open_bluetooth_settings, accounts::connect_steam_library, accounts::disconnect_steam_library, accounts::install_owned_game, epic::connect_epic_library, epic::disconnect_epic_library, display::display_status, display::set_display_mode, display::set_brightness, display::set_cpu_boost, xbox_mode::xbox_mode_status, xbox_mode::set_xbox_mode_startup, xbox_mode::enter_xbox_mode])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_window_gets_the_same_webview_arguments() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["app"]["windows"][0]["additionalBrowserArgs"], WEBVIEW_ARGS);
    }

    #[test]
    fn launchers_are_recognised_by_file_name_only() {
        assert!(is_launcher("steam.exe"));
        assert!(is_launcher("SteamWebHelper.exe"));
        assert!(is_launcher("EpicGamesLauncher.exe"));
        assert!(!is_launcher("eldenring.exe"));
        assert!(!is_launcher("sofa.exe"));
    }
}

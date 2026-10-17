use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, PartialEq, Clone, Default)]
pub struct Game {
    pub id: String,
    pub title: String,
    pub source: &'static str,
    /// URI (steam://, com.epicgames.launcher://) or an executable path.
    pub launch: String,
    pub cover: Option<String>,
    pub installed: bool,
    /// Unix seconds of the last session the launcher recorded (Steam), for sorting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<u64>,
    /// Total minutes played, as Steam counts it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playtime: Option<u32>,
    /// Bytes on disk, when the launcher's manifest records it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

pub fn scan() -> Vec<Game> {
    let mut games = steam();
    games.extend(epic());
    games.extend(gog());
    games.extend(crate::xbox_library::games());
    // The same Steam library can be listed twice with different spellings
    // (registry `c:/program files (x86)/steam` vs vdf `C:\Program Files (x86)\Steam`).
    games.sort_by(|a, b| a.id.cmp(&b.id));
    games.dedup_by(|a, b| a.id == b.id);
    games.sort_by_key(|g| g.title.to_lowercase());
    games
}

pub fn scan_with_custom(app: &tauri::AppHandle) -> Vec<Game> {
    let mut games = scan();
    games.extend(crate::apps::custom_games(app));
    games.sort_by_key(|game| game.title.to_lowercase());
    games
}

// ---------- Steam: libraryfolders.vdf + appmanifest_*.acf ----------

/// Pairs of quoted tokens per line: `"key"  "value"`. Enough for the flat parts of VDF/ACF we read.
fn vdf_pairs(text: &str) -> impl Iterator<Item = (&str, String)> {
    text.lines().filter_map(|line| {
        let t: Vec<&str> = line.split('"').collect();
        (t.len() >= 5).then(|| (t[1], t[3].replace("\\\\", "\\")))
    })
}

/// An installed Steam game from its appmanifest. Only the first value of each key counts:
/// nested sections (UserConfig) repeat names.
/// Steam writes the manifest when a download starts; the game is installed only once the
/// FullyInstalled flag (4) is set.
const STATE_FULLY_INSTALLED: u64 = 4;

fn parse_acf(text: &str) -> Option<Game> {
    let (mut id, mut name, mut last_played, mut size, mut flags) = (None, None, None, None, None);
    for (k, v) in vdf_pairs(text) {
        match k {
            "appid" if id.is_none() => id = Some(v),
            "name" if name.is_none() => name = Some(v),
            "LastPlayed" if last_played.is_none() => last_played = v.parse().ok().filter(|t| *t > 0),
            "SizeOnDisk" if size.is_none() => size = v.parse().ok().filter(|b| *b > 0),
            "StateFlags" if flags.is_none() => flags = v.parse::<u64>().ok(),
            _ => {}
        }
    }
    if flags.is_some_and(|f| f & STATE_FULLY_INSTALLED == 0) {
        return None;
    }
    Some(Game {
        last_played,
        size,
        ..steam_game(id?, name?, true)
    })
}

/// Download state of a Steam install in progress, from the same manifest.
#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
pub struct InstallProgress {
    pub downloaded: u64,
    pub total: u64,
    pub installed: bool,
}

pub(crate) fn parse_progress(text: &str) -> InstallProgress {
    let (mut downloaded, mut total, mut flags) = (0, 0, 0);
    for (k, v) in vdf_pairs(text) {
        match k {
            "BytesDownloaded" => downloaded = v.parse().unwrap_or(0),
            "BytesToDownload" => total = v.parse().unwrap_or(0),
            "StateFlags" => flags = v.parse().unwrap_or(0),
            _ => {}
        }
    }
    InstallProgress { downloaded, total, installed: flags & STATE_FULLY_INSTALLED != 0 }
}

/// Folder name of an installed title under `steamapps/common`, from its manifest.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(crate) fn steam_install_dir(text: &str) -> Option<String> {
    vdf_pairs(text).find(|(k, _)| *k == "installdir").map(|(_, v)| v)
}

/// Every Steam library folder: the root plus those listed in `libraryfolders.vdf`.
pub(crate) fn steam_libraries() -> Vec<PathBuf> {
    let Some(root) = steam_root() else { return vec![] };
    let mut libs = vec![root.clone()];
    if let Ok(vdf) = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
        libs.extend(vdf_pairs(&vdf).filter(|(k, _)| *k == "path").map(|(_, v)| PathBuf::from(v)));
    }
    libs.sort();
    libs.dedup();
    libs
}

/// None until Steam has written the manifest (the user hasn't confirmed the install yet).
pub fn steam_install_progress(id: &str) -> Option<InstallProgress> {
    let app_id = steam_app_id(id)?;
    steam_libraries()
        .iter()
        .map(|lib| lib.join("steamapps").join(format!("appmanifest_{app_id}.acf")))
        .find_map(|path| fs::read_to_string(path).ok())
        .map(|text| parse_progress(&text))
}

/// Numeric app id from a `steam:<appid>` game id; the webview only ever sends ids.
pub fn steam_app_id(id: &str) -> Option<&str> {
    id.strip_prefix("steam:")
        .filter(|v| !v.is_empty() && v.len() <= 10 && v.bytes().all(|b| b.is_ascii_digit()))
}

pub fn steam_game(app_id: impl std::fmt::Display, title: String, installed: bool) -> Game {
    Game {
        cover: Some(format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/library_600x900.jpg")),
        launch: format!("steam://rungameid/{app_id}"),
        id: format!("steam:{app_id}"),
        title,
        source: "steam",
        installed,
        ..Game::default()
    }
}

/// Use Steam's executable on Windows so launching does not depend on the URL association.
/// The client handles both a cold start and forwarding to an already running instance.
pub fn launch_game(game: &Game) -> Result<(), String> {
    if game.source == "xbox" {
        return crate::xbox_library::launch(&game.id);
    }
    #[cfg(windows)]
    if game.source == "steam" {
        let root = steam_root().ok_or("Steam installation not found")?;
        return steam_launch_command(&root, &game.id)?
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Steam launch failed: {e}"));
    }
    if game.launch.contains("://") {
        tauri_plugin_opener::open_url(&game.launch, None::<&str>)
    } else {
        tauri_plugin_opener::open_path(&game.launch, None::<&str>)
    }
    .map_err(|e| e.to_string())
}

#[cfg(any(windows, test))]
fn steam_launch_command(root: &Path, id: &str) -> Result<std::process::Command, String> {
    let app_id = steam_app_id(id).ok_or("Invalid Steam app id")?;
    let mut command = std::process::Command::new(root.join("steam.exe"));
    // Client flags must precede -applaunch; subsequent arguments belong to the game.
    command.current_dir(root).args(["-silent", "-applaunch", app_id]);
    Ok(command)
}

/// The Steam app currently running, as reported by the Steam client.
pub fn running_steam_app() -> Option<u32> {
    #[cfg(windows)]
    {
        use winreg::{RegKey, enums::HKEY_CURRENT_USER};
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Valve\Steam")
            .and_then(|k| k.get_value::<u32, _>("RunningAppID"))
            .ok()
            .filter(|id| *id != 0)
    }
    #[cfg(not(windows))]
    None
}

/// Big Picture keeps reading the controller while it sits behind Sofa, so every press moved
/// both. When Sofa comes to the front with Big Picture open, close it; Steam stays in the tray.
#[cfg(windows)]
pub(crate) fn close_big_picture(app: &tauri::AppHandle) {
    if !big_picture_open() {
        return;
    }
    crate::log::info(app, "steam: closing Big Picture behind Sofa");
    if tauri_plugin_opener::open_url("steam://close/bigpicture", None::<&str>).is_ok() {
        // Leaving Big Picture can raise Steam's desktop window; push it back down.
        crate::keep_sofa_in_front(app.clone());
    }
}

/// Big Picture is a CEF window of class `SDL_app` whose title names it in every language;
/// Steam's desktop window shares the class but not the title. Minimized still counts.
#[cfg(windows)]
fn big_picture_open() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetWindowTextW, IsWindowVisible};
    let class: Vec<u16> = "SDL_app\0".encode_utf16().collect();
    let mut window = std::ptr::null_mut();
    loop {
        // Top-level windows of that class after `window`; null class name terminator above.
        window = unsafe { FindWindowExW(std::ptr::null_mut(), window, class.as_ptr(), std::ptr::null()) };
        if window.is_null() {
            return false;
        }
        let mut title = [0u16; 256];
        // Writes at most `title.len()` units, null-terminated, and returns the length.
        let length = unsafe { GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32) } as usize;
        // `window` was just returned by Windows.
        if String::from_utf16_lossy(&title[..length]).contains("Big Picture") && unsafe { IsWindowVisible(window) } != 0 {
            return true;
        }
    }
}

// Redistributables / runtimes that show up as "installed apps" but aren't games.
const STEAM_SKIP: &[&str] = &["228980", "1070560", "1391110", "1628350", "1493710"];

pub(crate) fn steam_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::{RegKey, enums::HKEY_CURRENT_USER};
        if let Ok(p) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Valve\Steam")
            .and_then(|k| k.get_value::<String, _>("SteamPath"))
        {
            return Some(PathBuf::from(p));
        }
        Some(PathBuf::from(r"C:\Program Files (x86)\Steam")).filter(|p| p.exists())
    }
    #[cfg(not(windows))]
    {
        let home = PathBuf::from(std::env::var_os("HOME")?);
        ["Library/Application Support/Steam", ".local/share/Steam", ".steam/steam"]
            .iter()
            .map(|p| home.join(p))
            .find(|p| p.exists())
    }
}

fn steam() -> Vec<Game> {
    steam_libraries()
        .iter()
        .filter_map(|lib| fs::read_dir(lib.join("steamapps")).ok())
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("appmanifest_"))
        .filter_map(|e| parse_acf(&fs::read_to_string(e.path()).ok()?))
        .filter(|game| !STEAM_SKIP.iter().any(|skip| game.id == format!("steam:{skip}")))
        .collect()
}

// ---------- Epic: launcher manifests (*.item JSON) ----------

fn parse_epic_item(text: &str) -> Option<Game> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_owned);
    if v.get("bIsIncompleteInstall").and_then(|x| x.as_bool()) == Some(true) {
        return None;
    }
    Some(Game {
        size: v.get("InstallSize").and_then(|x| x.as_u64()).filter(|b| *b > 0),
        ..epic_game(&s("CatalogNamespace")?, &s("CatalogItemId")?, &s("AppName")?, s("DisplayName")?, true)
    })
}

pub fn epic_game(namespace: &str, item_id: &str, app: &str, title: String, installed: bool) -> Game {
    Game {
        id: format!("epic:{app}"),
        title,
        source: "epic",
        launch: format!("com.epicgames.launcher://apps/{namespace}%3A{item_id}%3A{app}?action=launch&silent=true"),
        installed,
        ..Game::default()
    }
}

pub(crate) fn epic_manifests_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let dir = PathBuf::from(std::env::var_os("ProgramData")?).join(r"Epic\EpicGamesLauncher\Data\Manifests");
    #[cfg(not(windows))]
    let dir = PathBuf::from(std::env::var_os("HOME")?)
        .join("Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests");
    Some(dir)
}

/// Install folder an Epic manifest records for one app.
pub(crate) fn epic_install_location(app: &str) -> Option<PathBuf> {
    read_files(&epic_manifests_dir()?, "item")
        .filter_map(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .find(|item| item["AppName"] == app)
        .and_then(|item| item["InstallLocation"].as_str().map(PathBuf::from))
}

fn epic() -> Vec<Game> {
    let Some(dir) = epic_manifests_dir() else { return vec![] };
    read_files(&dir, "item").filter_map(|t| parse_epic_item(&t)).collect()
}

fn read_files<'a>(dir: &Path, ext: &'a str) -> impl Iterator<Item = String> + 'a {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(move |p| p.extension().is_some_and(|x| x == ext))
        .filter_map(|p| fs::read_to_string(p).ok())
}

// ---------- GOG: Galaxy/offline installers register under HKLM (Windows only) ----------

#[cfg(windows)]
fn gog() -> Vec<Game> {
    use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};
    let Ok(root) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\WOW6432Node\GOG.com\Games") else {
        return vec![];
    };
    root.enum_keys()
        .flatten()
        .filter_map(|id| {
            let k = root.open_subkey(&id).ok()?;
            let get = |n: &str| k.get_value::<String, _>(n).ok();
            Some(Game {
                title: get("gameName").or_else(|| get("GAMENAME"))?,
                launch: get("exe").or_else(|| get("EXE"))?,
                id: format!("gog:{id}"),
                source: "gog",
                installed: true,
                ..Game::default()
            })
        })
        .collect()
}

#[cfg(not(windows))]
fn gog() -> Vec<Game> {
    vec![]
}

/// Galaxy's local library cache includes owned titles that are not installed. An absent or
/// changed private schema leaves this source empty without affecting installed games.
#[cfg(windows)]
pub fn gog_owned() -> Vec<Game> {
    use rusqlite::{Connection, OpenFlags};
    let Some(program_data) = std::env::var_os("ProgramData") else { return vec![] };
    let path = PathBuf::from(program_data).join(r"GOG.com\Galaxy\storage\galaxy-2.0.db");
    let Ok(db) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) else {
        return vec![];
    };
    let Ok(mut query) = db.prepare(
        "SELECT lr.releaseKey, gp.value FROM LibraryReleases lr \
         JOIN GamePieces gp ON gp.releaseKey = lr.releaseKey \
         WHERE lr.releaseKey LIKE 'gog_%' AND gp.value IS NOT NULL",
    ) else { return vec![] };
    let Ok(rows) = query.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))) else {
        return vec![];
    };
    let mut games: Vec<Game> = rows.flatten().filter_map(|(key, value)| gog_owned_piece(&key, &value)).collect();
    games.sort_by(|a, b| a.id.cmp(&b.id));
    games.dedup_by(|a, b| a.id == b.id);
    games.sort_by_key(|game| game.title.to_lowercase());
    games
}

#[cfg(not(windows))]
pub fn gog_owned() -> Vec<Game> {
    vec![]
}

#[cfg(any(windows, test))]
fn gog_owned_piece(key: &str, value: &str) -> Option<Game> {
    let id = key.strip_prefix("gog_")?;
    if id.is_empty() || id.len() > 20 || !id.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(value).ok()?;
    let title = parsed.get("title")?.as_str()?.trim();
    if title.is_empty() {
        return None;
    }
    Some(Game {
        id: format!("gog:{id}"),
        title: title.to_owned(),
        source: "gog",
        installed: false,
        ..Game::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gog_library_piece_accepts_only_numeric_gog_games_with_titles() {
        let game = gog_owned_piece("gog_123456", r#"{"title":"A Game"}"#).unwrap();
        assert_eq!((game.id.as_str(), game.title.as_str(), game.installed), ("gog:123456", "A Game", false));
        assert!(gog_owned_piece("epic_123456", r#"{"title":"A Game"}"#).is_none());
        assert!(gog_owned_piece("gog_12/path", r#"{"title":"A Game"}"#).is_none());
        assert!(gog_owned_piece("gog_123456", r#"{"title":"  "}"#).is_none());
    }

    #[test]
    fn a_downloading_manifest_is_not_an_installed_game() {
        let downloading = "\"AppState\"\n{\n\t\"appid\"\t\t\"620\"\n\t\"name\"\t\t\"Portal 2\"\n\t\"StateFlags\"\t\t\"1026\"\n\t\"BytesToDownload\"\t\t\"1000\"\n\t\"BytesDownloaded\"\t\t\"250\"\n}";
        assert!(parse_acf(downloading).is_none());
        assert_eq!(parse_progress(downloading), InstallProgress { downloaded: 250, total: 1000, installed: false });
        let done = downloading.replace("1026", "4");
        assert_eq!(parse_acf(&done).map(|g| g.id).as_deref(), Some("steam:620"));
        assert!(parse_progress(&done).installed);
    }

    #[test]
    fn launches_steam_with_separate_app_id_and_install_directory() {
        let root = Path::new("C:/Program Files (x86)/Steam");
        let command = steam_launch_command(root, "steam:1245620").unwrap();
        assert_eq!(command.get_program(), root.join("steam.exe"));
        assert_eq!(command.get_current_dir(), Some(root));
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["-silent", "-applaunch", "1245620"]);
    }

    #[test]
    fn rejects_invalid_steam_launch_ids() {
        for id in ["steam:", "steam:620 -shutdown", "steam:1/2", "steam:12345678901", "epic:620", "steam://rungameid/620"] {
            assert!(steam_launch_command(Path::new("Steam"), id).is_err());
        }
    }

    #[test]
    fn parses_acf() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"1245620\"\n\t\"name\"\t\t\"ELDEN RING\"\n\t\"LastPlayed\"\t\t\"1700000000\"\n\t\"SizeOnDisk\"\t\t\"52000000000\"\n\t\"UserConfig\"\n\t{\n\t\t\"name\"\t\t\"x\"\n\t}\n}";
        let game = parse_acf(acf).unwrap();
        assert_eq!((game.id.as_str(), game.title.as_str()), ("steam:1245620", "ELDEN RING"));
        assert_eq!((game.last_played, game.size), (Some(1_700_000_000), Some(52_000_000_000)));
    }

    #[test]
    fn parses_library_paths_with_escapes() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        let paths: Vec<_> = vdf_pairs(vdf).filter(|(k, _)| *k == "path").map(|(_, v)| v).collect();
        assert_eq!(paths, vec![r"D:\SteamLibrary".to_string()]);
    }

    #[test]
    fn dedupes_same_game_from_two_library_paths() {
        let mut games: Vec<Game> = ["steam:1", "steam:1", "epic:a"]
            .iter()
            .map(|id| Game { id: id.to_string(), title: "x".into(), source: "steam", installed: true, ..Game::default() })
            .collect();
        games.sort_by(|a, b| a.id.cmp(&b.id));
        games.dedup_by(|a, b| a.id == b.id);
        assert_eq!(games.iter().map(|g| g.id.as_str()).collect::<Vec<_>>(), ["epic:a", "steam:1"]);
    }

    #[test]
    fn parses_epic_item() {
        let item = r#"{"DisplayName":"Hades","AppName":"Min","CatalogNamespace":"ns","CatalogItemId":"cid","bIsIncompleteInstall":false}"#;
        let g = parse_epic_item(item).unwrap();
        assert_eq!(g.title, "Hades");
        assert_eq!(g.launch, "com.epicgames.launcher://apps/ns%3Acid%3AMin?action=launch&silent=true");
        assert!(parse_epic_item(&item.replace("false", "true")).is_none());
    }
}

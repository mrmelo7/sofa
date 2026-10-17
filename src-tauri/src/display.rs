use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub struct Mode {
    width: u32,
    height: u32,
    refresh: u32,
}

#[derive(Serialize, Default)]
pub struct DisplayStatus {
    pub(crate) current: Option<Mode>,
    modes: Vec<Mode>,
    pub(crate) brightness: Option<u8>,
    cpu_boost: Option<bool>,
    /// Windows' global Auto HDR switch; the panel still has to support HDR for it to matter.
    auto_hdr: Option<bool>,
}

/// `DirectXUserGlobalSettings` is a `Key=Value;` list; Auto HDR is one of its entries.
#[cfg(any(windows, test))]
fn auto_hdr_enabled(settings: &str) -> bool {
    settings.split(';').any(|entry| entry.trim() == "AutoHDREnable=1")
}

#[cfg(any(windows, test))]
fn with_auto_hdr(settings: &str, on: bool) -> String {
    let mut entries: Vec<String> = settings
        .split(';')
        .map(str::trim)
        .filter(|e| !e.is_empty() && !e.starts_with("AutoHDREnable="))
        .map(str::to_owned)
        .collect();
    entries.push(format!("AutoHDREnable={}", u8::from(on)));
    entries.iter().map(|e| format!("{e};")).collect()
}

#[cfg(windows)]
const GPU_PREFERENCES: &str = r"Software\Microsoft\DirectX\UserGpuPreferences";

#[cfg(windows)]
fn read_auto_hdr() -> Option<bool> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    let settings: String = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(GPU_PREFERENCES)
        .and_then(|k| k.get_value("DirectXUserGlobalSettings"))
        .unwrap_or_default();
    Some(auto_hdr_enabled(&settings))
}

#[cfg(windows)]
fn write_auto_hdr(on: bool) -> Result<(), String> {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(GPU_PREFERENCES)
        .map_err(|_| "settingUnavailable")?;
    let settings: String = key.get_value("DirectXUserGlobalSettings").unwrap_or_default();
    key.set_value("DirectXUserGlobalSettings", &with_auto_hdr(&settings, on))
        .map_err(|_| "settingUnavailable".into())
}

/// Games started afterwards pick the new value up; Windows itself needs no restart.
#[tauri::command]
pub async fn set_auto_hdr(on: bool) -> Result<(), String> {
    blocking(move || write_auto_hdr(on)).await
}

#[cfg(not(windows))]
fn write_auto_hdr(_on: bool) -> Result<(), String> {
    Err("settingUnavailable".into())
}

/// Reads the `brightness=` and `boost=` lines printed by the status script.
#[cfg(any(windows, test))]
fn parse_settings(output: &str) -> (Option<u8>, Option<bool>) {
    let value = |key: &str| {
        output
            .lines()
            .find_map(|line| line.trim().strip_prefix(key)?.parse::<u32>().ok())
    };
    (
        value("brightness=").filter(|b| *b <= 100).map(|b| b as u8),
        value("boost=").map(|b| b != 0),
    )
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "settingUnavailable".to_string())?
}

#[tauri::command]
pub async fn display_status() -> DisplayStatus {
    blocking(|| Ok(status())).await.unwrap_or_default()
}

#[tauri::command]
pub async fn set_display_mode(mode: Mode, app: tauri::AppHandle) -> Result<(), String> {
    blocking(move || set_mode(mode)).await?;
    // The window may still have the old resolution's size.
    if let Some(main) = tauri::Manager::get_webview_window(&app, "main") {
        crate::fit_to_monitor(main.as_ref().window());
    }
    Ok(())
}

#[tauri::command]
pub async fn set_brightness(percent: u8) -> Result<(), String> {
    if percent > 100 {
        return Err("invalidInput".into());
    }
    blocking(move || {
        run(&format!(
            "$ErrorActionPreference='Stop'; \
             $m=Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1; \
             if($null -eq $m){{exit 1}}; \
             Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{{Timeout=[uint32]0; Brightness=[byte]{percent}}} | Out-Null; 'ok'"
        ))
    })
    .await
}

#[tauri::command]
pub async fn set_cpu_boost(on: bool) -> Result<(), String> {
    // 2 = Aggressive (Windows' default on most laptops), 0 = Disabled.
    let value = if on { 2 } else { 0 };
    blocking(move || {
        run(&format!(
            "powercfg /setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE {value}; if($LASTEXITCODE){{exit 1}}; \
             powercfg /setdcvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE {value}; if($LASTEXITCODE){{exit 1}}; \
             powercfg /setactive SCHEME_CURRENT; if($LASTEXITCODE){{exit 1}}; 'ok'"
        ))
    })
    .await
}

#[cfg(windows)]
fn run(script: &str) -> Result<(), String> {
    match crate::ally::powershell(script) {
        Ok(out) if out.trim() == "ok" => Ok(()),
        _ => Err("settingUnavailable".into()),
    }
}

#[cfg(not(windows))]
fn run(_script: &str) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[cfg(windows)]
fn status() -> DisplayStatus {
    // powercfg prints localized labels, so only the trailing hex values (AC, then DC) are read.
    let (brightness, cpu_boost) = crate::ally::powershell(
        "$b=(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1).CurrentBrightness; \
         if($null -ne $b){\"brightness=$b\"}; \
         $v=@(powercfg /q SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE | Select-String ': 0x([0-9a-fA-F]+)\\s*$' | ForEach-Object {[Convert]::ToInt32($_.Matches[0].Groups[1].Value,16)}); \
         if($v.Count){\"boost=$(($v | Measure-Object -Maximum).Maximum)\"}",
    )
    .map(|out| parse_settings(&out))
    .unwrap_or_default();
    let (current, modes) = modes();
    DisplayStatus {
        current,
        modes,
        brightness,
        cpu_boost,
        auto_hdr: read_auto_hdr(),
    }
}

#[cfg(not(windows))]
fn status() -> DisplayStatus {
    DisplayStatus::default()
}

#[cfg(windows)]
fn blank_mode() -> windows_sys::Win32::Graphics::Gdi::DEVMODEW {
    use windows_sys::Win32::Graphics::Gdi::DEVMODEW;
    // The API requires a zeroed struct with dmSize set.
    DEVMODEW {
        dmSize: std::mem::size_of::<DEVMODEW>() as u16,
        ..Default::default()
    }
}

#[cfg(windows)]
fn modes() -> (Option<Mode>, Vec<Mode>) {
    use windows_sys::Win32::Graphics::Gdi::*;
    let mut dm = blank_mode();
    let read = |dm: &DEVMODEW| Mode {
        width: dm.dmPelsWidth,
        height: dm.dmPelsHeight,
        refresh: dm.dmDisplayFrequency,
    };
    let current = (unsafe { EnumDisplaySettingsW(std::ptr::null(), ENUM_CURRENT_SETTINGS, &mut dm) } != 0)
        .then(|| read(&dm));
    let mut modes = Vec::new();
    let mut index = 0;
    while unsafe { EnumDisplaySettingsW(std::ptr::null(), index, &mut dm) } != 0 {
        let mode = read(&dm);
        if dm.dmBitsPerPel == 32 && mode.refresh > 1 && !modes.contains(&mode) {
            modes.push(mode);
        }
        index += 1;
    }
    modes.sort_by_key(|m| std::cmp::Reverse((m.width * m.height, m.width, m.refresh)));
    (current, modes)
}

#[cfg(windows)]
fn set_mode(mode: Mode) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Gdi::*;
    // Only modes the driver reported; the webview can't request arbitrary timings.
    if !modes().1.contains(&mode) {
        return Err("invalidInput".into());
    }
    let mut dm = blank_mode();
    dm.dmPelsWidth = mode.width;
    dm.dmPelsHeight = mode.height;
    dm.dmDisplayFrequency = mode.refresh;
    dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
    // Dynamic change only (flags 0): if the panel can't show a mode, a reboot restores the saved one.
    let result = unsafe {
        ChangeDisplaySettingsExW(std::ptr::null(), &dm, std::ptr::null_mut(), 0, std::ptr::null())
    };
    if result == DISP_CHANGE_SUCCESSFUL {
        Ok(())
    } else {
        Err("settingUnavailable".into())
    }
}

#[cfg(not(windows))]
fn set_mode(_mode: Mode) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_hdr_entry_is_replaced_in_the_gpu_preferences_list() {
        assert!(auto_hdr_enabled("SwapEffectUpgradeEnable=1;AutoHDREnable=1;"));
        assert!(!auto_hdr_enabled("AutoHDREnable=0;"));
        assert!(!auto_hdr_enabled(""));
        assert_eq!(with_auto_hdr("", true), "AutoHDREnable=1;");
        assert_eq!(
            with_auto_hdr("SwapEffectUpgradeEnable=1;AutoHDREnable=1;", false),
            "SwapEffectUpgradeEnable=1;AutoHDREnable=0;"
        );
    }

    #[test]
    fn parses_status_script_output() {
        assert_eq!(parse_settings("brightness=70\r\nboost=2\r\n"), (Some(70), Some(true)));
        assert_eq!(parse_settings("boost=0"), (None, Some(false)));
        assert_eq!(parse_settings("brightness=250\nboost=x"), (None, None));
        assert_eq!(parse_settings(""), (None, None));
    }
}

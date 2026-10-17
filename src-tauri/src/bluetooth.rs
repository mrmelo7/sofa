//! Pair a Bluetooth controller from inside Sofa, through Windows' own device enumeration
//! (WinRT). Windows keeps the pairing; Sofa only drives the ceremony.
use serde::Serialize;
use std::sync::Mutex;

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Found {
    /// Windows device id; opaque to the UI, which only hands it back to `bluetooth_pair`.
    id: String,
    name: String,
}

/// The last scan; a pairing request must name one of these ids.
#[derive(Default)]
pub struct Scan(Mutex<Vec<Found>>);

#[cfg(windows)]
fn init_winrt() {
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};
    // Per blocking thread; initialising again just reports so.
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
}

/// Bluetooth devices for each selector, as Windows reports them while it looks, for at most
/// `timeout`. The selectors name association endpoints, which a plain `FindAllAsync` (device
/// interfaces) never returns; and a watcher can be cut short instead of waiting out a slow
/// Bluetooth inquiry.
#[cfg(windows)]
fn endpoints(
    selectors: &[windows::core::Result<windows::core::HSTRING>],
    timeout: std::time::Duration,
) -> Result<Vec<Vec<windows::Devices::Enumeration::DeviceInformation>>, String> {
    use std::sync::{Arc, mpsc};
    use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind, DeviceInformationUpdate};
    use windows::Foundation::TypedEventHandler;
    use windows::core::{IInspectable, Ref};
    init_winrt();
    let unavailable = |_| "settingUnavailable".to_string();
    let (done, finished) = mpsc::channel();
    let mut watchers = Vec::new();
    for selector in selectors {
        let selector = selector.as_ref().map_err(|_| "settingUnavailable")?;
        let watcher = DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(
            selector,
            None,
            DeviceInformationKind::AssociationEndpoint,
        )
        .map_err(unavailable)?;
        let found = Arc::new(Mutex::new(Vec::new()));
        let sink = found.clone();
        watcher
            .Added(&TypedEventHandler::new(move |_, info: Ref<DeviceInformation>| {
                if let (Some(info), Ok(mut list)) = (info.as_ref(), sink.lock()) {
                    list.push(info.clone());
                }
                Ok(())
            }))
            .map_err(unavailable)?;
        // Without an Updated handler some watchers never report Added or completion.
        watcher
            .Updated(&TypedEventHandler::new(|_, _: Ref<DeviceInformationUpdate>| Ok(())))
            .map_err(unavailable)?;
        let done = done.clone();
        watcher
            .EnumerationCompleted(&TypedEventHandler::new(move |_, _: Ref<IInspectable>| {
                let _ = done.send(());
                Ok(())
            }))
            .map_err(unavailable)?;
        watcher.Start().map_err(unavailable)?;
        watchers.push((watcher, found));
    }
    let deadline = std::time::Instant::now() + timeout;
    for _ in 0..watchers.len() {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        if finished.recv_timeout(left).is_err() {
            break;
        }
    }
    Ok(watchers
        .into_iter()
        .map(|(watcher, found)| {
            let _ = watcher.Stop();
            found.lock().map(|list| list.clone()).unwrap_or_default()
        })
        .collect())
}

/// Unpaired classic and Low Energy devices in range; controllers must be in pairing mode.
#[cfg(windows)]
fn scan() -> Result<Vec<Found>, String> {
    use windows::Devices::Bluetooth::{BluetoothDevice, BluetoothLEDevice};
    let selectors = [
        BluetoothDevice::GetDeviceSelectorFromPairingState(false),
        BluetoothLEDevice::GetDeviceSelectorFromPairingState(false),
    ];
    let found = endpoints(&selectors, std::time::Duration::from_secs(10))?
        .into_iter()
        .flatten()
        .filter_map(|device| {
            let name = device.Name().ok()?.to_string();
            let id = device.Id().ok()?.to_string();
            (!name.trim().is_empty() && !id.is_empty()).then(|| Found { id, name: name.trim().to_owned() })
        })
        .collect();
    Ok(dedup(found))
}

/// The endpoint behind an id from `endpoints`.
#[cfg(windows)]
fn endpoint(id: &str) -> windows::core::Result<windows::Devices::Enumeration::DeviceInformation> {
    use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind};
    DeviceInformation::CreateFromIdAsyncWithKindAndAdditionalProperties(
        &windows::core::HSTRING::from(id),
        None,
        DeviceInformationKind::AssociationEndpoint,
    )?
    .join()
}

#[cfg(any(windows, test))]
fn dedup(mut found: Vec<Found>) -> Vec<Found> {
    found.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    found.dedup_by(|a, b| a.id == b.id);
    found
}

#[cfg(windows)]
fn pair(id: &str) -> Result<(), String> {
    use windows::Devices::Enumeration::{
        DevicePairingKinds, DevicePairingRequestedEventArgs, DevicePairingResultStatus,
    };
    use windows::Foundation::TypedEventHandler;
    init_winrt();
    let failed = |_| "bluetoothPairFailed".to_string();
    let device = endpoint(id).map_err(failed)?;
    let custom = device.Pairing().and_then(|p| p.Custom()).map_err(failed)?;
    // Controllers pair without a code ("just works") or ask only for confirmation.
    let token = custom
        .PairingRequested(&TypedEventHandler::new(|_, args: windows::core::Ref<DevicePairingRequestedEventArgs>| {
            if let Some(args) = args.as_ref() {
                args.Accept()?;
            }
            Ok(())
        }))
        .map_err(failed)?;
    let kinds = DevicePairingKinds(DevicePairingKinds::ConfirmOnly.0 | DevicePairingKinds::None.0);
    let result = custom.PairAsync(kinds).and_then(|operation| operation.join());
    let _ = custom.RemovePairingRequested(token);
    let status = result.and_then(|r| r.Status()).map_err(failed)?;
    if status == DevicePairingResultStatus::Paired || status == DevicePairingResultStatus::AlreadyPaired {
        Ok(())
    } else {
        Err(format!("bluetoothPairFailed:{}", status.0))
    }
}

/// A controller Windows has paired: gamepads and joysticks only, so headphones and keyboards
/// never get an unpair button here.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Paired {
    /// Windows device id; opaque to the UI, which only hands it back to `bluetooth_unpair`.
    id: String,
    name: String,
    connected: bool,
}

#[cfg(windows)]
fn paired() -> Result<Vec<Paired>, String> {
    use windows::Devices::Bluetooth::{
        BluetoothConnectionStatus, BluetoothDevice, BluetoothLEAppearanceCategories,
        BluetoothLEAppearanceSubcategories, BluetoothLEDevice, BluetoothMajorClass,
    };
    init_winrt();
    let unavailable = |_| "settingUnavailable".to_string();
    // Paired devices are already known to Windows; listing them is quick.
    let lists = endpoints(
        &[
            BluetoothDevice::GetDeviceSelectorFromPairingState(true),
            BluetoothLEDevice::GetDeviceSelectorFromPairingState(true),
        ],
        std::time::Duration::from_secs(5),
    )?;
    let ids = |index: usize| -> Vec<String> {
        lists.get(index).into_iter().flatten().filter_map(|d| d.Id().ok().map(|id| id.to_string())).collect()
    };
    let mut found = Vec::new();
    // Classic Bluetooth (DualSense, most third-party pads): a peripheral whose minor class
    // is joystick (1) or gamepad (2); the upper bits only add keyboard or pointer.
    for id in ids(0) {
        let Ok(device) = BluetoothDevice::FromIdAsync(&id.as_str().into()).and_then(|o| o.join()) else { continue };
        let Ok(class) = device.ClassOfDevice() else { continue };
        let gamepad = class.MajorClass().is_ok_and(|major| major == BluetoothMajorClass::Peripheral)
            && class.MinorClass().is_ok_and(|minor| matches!(minor.0 & 0xf, 1 | 2));
        if gamepad {
            let connected = device.ConnectionStatus().is_ok_and(|s| s == BluetoothConnectionStatus::Connected);
            found.push((id, device.Name().map(|n| n.to_string()).unwrap_or_default(), connected));
        }
    }
    // Bluetooth Low Energy (Xbox controllers): HID appearance, gamepad or joystick.
    let hid = BluetoothLEAppearanceCategories::HumanInterfaceDevice().map_err(unavailable)?;
    let kinds = [BluetoothLEAppearanceSubcategories::Gamepad(), BluetoothLEAppearanceSubcategories::Joystick()];
    for id in ids(1) {
        let Ok(device) = BluetoothLEDevice::FromIdAsync(&id.as_str().into()).and_then(|o| o.join()) else { continue };
        let Ok(appearance) = device.Appearance() else { continue };
        let gamepad = appearance.Category().is_ok_and(|c| c == hid)
            && appearance.SubCategory().is_ok_and(|sub| kinds.iter().any(|k| k.as_ref().is_ok_and(|k| *k == sub)));
        if gamepad {
            let connected = device.ConnectionStatus().is_ok_and(|s| s == BluetoothConnectionStatus::Connected);
            found.push((id, device.Name().map(|n| n.to_string()).unwrap_or_default(), connected));
        }
    }
    Ok(found
        .into_iter()
        .filter(|(_, name, _)| !name.trim().is_empty())
        .map(|(id, name, connected)| Paired { id, name: name.trim().to_owned(), connected })
        .collect())
}

#[cfg(windows)]
fn unpair(id: &str) -> Result<(), String> {
    use windows::Devices::Enumeration::DeviceUnpairingResultStatus;
    init_winrt();
    let failed = |_| "bluetoothUnpairFailed".to_string();
    let status = endpoint(id)
        .and_then(|device| device.Pairing())
        .and_then(|pairing| pairing.UnpairAsync())
        .and_then(|operation| operation.join())
        .and_then(|result| result.Status())
        .map_err(failed)?;
    if status == DeviceUnpairingResultStatus::Unpaired || status == DeviceUnpairingResultStatus::AlreadyUnpaired {
        Ok(())
    } else {
        Err(format!("bluetoothUnpairFailed:{}", status.0))
    }
}

#[cfg(not(windows))]
fn paired() -> Result<Vec<Paired>, String> {
    Err("settingUnavailable".into())
}

#[cfg(not(windows))]
fn unpair(_id: &str) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[cfg(not(windows))]
fn scan() -> Result<Vec<Found>, String> {
    Err("settingUnavailable".into())
}

#[cfg(not(windows))]
fn pair(_id: &str) -> Result<(), String> {
    Err("settingUnavailable".into())
}

#[tauri::command]
pub async fn bluetooth_scan(app: tauri::AppHandle, state: tauri::State<'_, Scan>) -> Result<Vec<Found>, String> {
    let found = tauri::async_runtime::spawn_blocking(scan)
        .await
        .map_err(|_| "settingUnavailable".to_string())??;
    crate::log::info(&app, format!("bluetooth: {} unpaired devices in range", found.len()));
    *state.0.lock().map_err(|_| "serviceUnavailable")? = found.clone();
    Ok(found)
}

#[tauri::command]
pub async fn bluetooth_pair(id: String, app: tauri::AppHandle, state: tauri::State<'_, Scan>) -> Result<(), String> {
    let device = state
        .0
        .lock()
        .map_err(|_| "serviceUnavailable")?
        .iter()
        .find(|d| d.id == id)
        .cloned()
        .ok_or("invalidInput")?;
    crate::log::info(&app, format!("bluetooth: pairing {:?}", device.name));
    let result = tauri::async_runtime::spawn_blocking(move || pair(&device.id))
        .await
        .map_err(|_| "settingUnavailable".to_string())?;
    if let Err(error) = &result {
        crate::log::info(&app, format!("bluetooth: pairing failed: {error}"));
        return Err("bluetoothPairFailed".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn bluetooth_paired() -> Result<Vec<Paired>, String> {
    tauri::async_runtime::spawn_blocking(paired)
        .await
        .map_err(|_| "settingUnavailable".to_string())?
}

/// Takes an id from `bluetooth_paired` and checks it is still a paired controller, so the
/// webview can't unpair anything else.
#[tauri::command]
pub async fn bluetooth_unpair(id: String, app: tauri::AppHandle) -> Result<(), String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let device = paired()?.into_iter().find(|d| d.id == id).ok_or("invalidInput")?;
        crate::log::info(&app, format!("bluetooth: unpairing {:?}", device.name));
        unpair(&device.id).inspect_err(|error| crate::log::info(&app, format!("bluetooth: unpairing failed: {error}")))
    })
    .await
    .map_err(|_| "settingUnavailable".to_string())?;
    result.map_err(|error| if error == "invalidInput" { error } else { "bluetoothUnpairFailed".into() })
}

/// Windows' own Bluetooth page, for anything the ceremony above can't do.
#[tauri::command]
pub async fn open_bluetooth_settings(app: tauri::AppHandle) -> Result<(), String> {
    crate::open_settings_page(&app, "ms-settings:bluetooth")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_results_are_sorted_by_name_without_duplicate_ids() {
        let found = dedup(vec![
            Found { id: "b".into(), name: "Xbox Wireless Controller".into() },
            Found { id: "a".into(), name: "DualSense".into() },
            Found { id: "b".into(), name: "Xbox Wireless Controller".into() },
        ]);
        assert_eq!(found.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    }
}

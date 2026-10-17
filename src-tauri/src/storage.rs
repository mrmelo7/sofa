//! Fixed disks and their free space, for the storage card in Settings.
use serde::Serialize;

#[derive(Serialize, Default, Clone)]
pub struct Disk {
    /// Mount point as Windows shows it (`C:\`).
    name: String,
    total: u64,
    available: u64,
}

fn disks() -> Vec<Disk> {
    let mut disks: Vec<Disk> = sysinfo::Disks::new_with_refreshed_list()
        .iter()
        .filter(|d| !d.is_removable() && d.total_space() > 0)
        .map(|d| Disk {
            name: d.mount_point().to_string_lossy().into_owned(),
            total: d.total_space(),
            available: d.available_space(),
        })
        .collect();
    disks.sort_by(|a, b| a.name.cmp(&b.name));
    disks.dedup_by(|a, b| a.name == b.name);
    disks
}

#[tauri::command]
pub async fn storage_status() -> Vec<Disk> {
    tauri::async_runtime::spawn_blocking(disks).await.unwrap_or_default()
}

/// Windows' own storage page handles cleanup; Sofa only shows the numbers.
#[tauri::command]
pub async fn open_storage_settings(app: tauri::AppHandle) -> Result<(), String> {
    crate::open_settings_page(&app, "ms-settings:storagesense")
}

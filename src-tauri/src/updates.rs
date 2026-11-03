//! Updates from the GitHub releases, also when only the build changed: every push to `main`
//! rebuilds the release of the current version, so its latest.json says which commit it was
//! built from (`<!-- build <sha> -->` at the end of its notes, see .github/workflows/release.yml).
//! A copy built from another commit of the same version is offered that build.
//! Local builds (no GITHUB_SHA when compiled) only take a newer version, never a rebuild.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Commit this copy was built from, set by GitHub Actions.
const BUILD: Option<&str> = option_env!("GITHUB_SHA");

/// The update found by `update_check`, installed by `update_install`.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    /// Same version, newer build: new features without a new number.
    rebuild: bool,
}

fn build_of(notes: &str) -> Option<&str> {
    notes.split("<!-- build ").nth(1)?.split(" -->").next().map(str::trim)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app
        .updater_builder()
        .version_comparator(|current, remote| {
            if remote.version > current {
                return true;
            }
            let theirs = remote.notes.as_deref().and_then(build_of);
            remote.version == current && matches!((BUILD, theirs), (Some(mine), Some(theirs)) if mine != theirs)
        })
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), rebuild: u.version == u.current_version });
    *app.state::<PendingUpdate>().0.lock().unwrap() = update;
    Ok(info)
}

/// Downloads and installs the pending update ("update-progress": 0…1, or null when the size is
/// unknown), then restarts. On Windows the installer closes Boofer and opens the new build itself.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let update = app.state::<PendingUpdate>().0.lock().unwrap().take().ok_or("no update to install")?;
    let handle = app.clone();
    let (mut total, mut received) = (0u64, 0u64);
    update
        .download_and_install(
            move |chunk, length| {
                if let Some(length) = length {
                    total = length;
                }
                received += chunk as u64;
                let progress = (total > 0).then(|| (received as f64 / total as f64).min(1.0));
                let _ = handle.emit("update-progress", progress);
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

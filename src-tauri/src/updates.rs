//! Updates from the GitHub releases, also when only the build changed: every push to `main`
//! rebuilds the release of the current version, so its latest.json says which commit it was
//! built from (`<!-- build <sha> -->` at the end of its notes, see .github/workflows/release.yml).
//! A copy built from another commit of the same version is offered that build.
//! Local builds (no GITHUB_SHA when compiled) only take a newer version, never a rebuild.
//!
//! Under Linux, only an AppImage replaces itself. A copy installed by a .deb is told about newer
//! versions and the settings open the page to download them: the updater plugin would run
//! `dpkg -i` as root behind a password prompt, which an automatic update at a calm moment (and
//! a new build at every push) can't be asking for.

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
    /// Commit the update was built from, when its latest.json says so.
    build: Option<String>,
    /// This copy can't install it: the user downloads it.
    manual: bool,
}

/// What the settings window adapts its words to.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct System {
    /// "windows", "linux"…
    os: &'static str,
    installs_updates: bool,
}

#[tauri::command]
pub fn system() -> System {
    System { os: std::env::consts::OS, installs_updates: installs_updates() }
}

fn installs_updates() -> bool {
    !cfg!(target_os = "linux") || is_appimage()
}

/// The bundler writes the bundle type in the binary, so a copy built by cargo is none. $APPIMAGE
/// doesn't tell: an AppImage (an editor) passes it on to the programs started from its terminal.
pub fn is_appimage() -> bool {
    tauri::utils::platform::bundle_type() == Some(tauri::utils::config::BundleType::AppImage)
}

/// Commit this copy was built from, or null for a build made on a PC.
#[tauri::command]
pub fn build_commit() -> Option<&'static str> {
    BUILD
}

fn build_of(notes: &str) -> Option<&str> {
    notes.split("<!-- build ").nth(1)?.split(" -->").next().map(str::trim)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let installs = installs_updates();
    let updater = app
        .updater_builder()
        .version_comparator(move |current, remote| {
            if remote.version > current {
                return true;
            }
            let theirs = remote.notes.as_deref().and_then(build_of);
            // A new build is nothing to download by hand: there's one at every push.
            installs && remote.version == current && matches!((BUILD, theirs), (Some(mine), Some(theirs)) if mine != theirs)
        })
        .build()
        .map_err(|e| e.to_string())?;
    let update = match updater.check().await {
        Ok(update) => update,
        // Windows publishes first and a Linux build can fail on its own: a release without
        // Linux in its latest.json is nothing to install yet, not an error.
        Err(tauri_plugin_updater::Error::TargetNotFound(_) | tauri_plugin_updater::Error::TargetsNotFound(_)) if cfg!(target_os = "linux") => None,
        Err(e) => return Err(e.to_string()),
    };
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        rebuild: u.version == u.current_version,
        build: u.body.as_deref().and_then(build_of).map(str::to_string),
        manual: !installs,
    });
    if installs {
        *app.state::<PendingUpdate>().0.lock().unwrap() = update;
    }
    Ok(info)
}

/// The installer doesn't always start Boofer again (it depends on how it was installed), so a
/// hidden helper waits for this process and the installer to be done, then starts the installed
/// exe unless a Boofer is already running.
fn relaunch_after_install() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let Ok(exe) = std::env::current_exe() else { return };
        let name = exe.file_stem().and_then(|s| s.to_str()).unwrap_or("boofer").to_string();
        let quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
        let script = format!(
            "$exe = {exe}; $name = {name}; $start = Get-Date; \
             try {{ Wait-Process -Id {pid} -Timeout 120 -ErrorAction Stop }} catch {{}}; \
             Start-Sleep -Seconds 8; \
             $deadline = (Get-Date).AddSeconds(90); $last = $null; $stable = 0; \
             while ((Get-Date) -lt $deadline) {{ \
               if (Get-Process -Name $name -ErrorAction SilentlyContinue) {{ exit }}; \
               $t = (Get-Item -LiteralPath $exe -ErrorAction SilentlyContinue).LastWriteTime; \
               if ($t -and $t -gt $start -and $t -eq $last) {{ $stable++ }} else {{ $stable = 0 }}; \
               if ($stable -ge 3) {{ break }}; \
               $last = $t; Start-Sleep -Seconds 2 }}; \
             if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $exe)) {{ Start-Process -FilePath $exe }}",
            exe = quote(&exe.display().to_string()),
            name = quote(&name),
            pid = std::process::id(),
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn();
    }
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
            relaunch_after_install,
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The test binary isn't patched by the bundler, like a copy built by cargo.
    #[test]
    fn a_copy_built_by_cargo_installs_nothing_under_linux() {
        assert!(!is_appimage());
        assert_eq!(installs_updates(), !cfg!(target_os = "linux"));
    }
}

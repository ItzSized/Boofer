//! « Booffer » (two f) became « Boofer ». The installer under the new name installs next to the
//! old copy, so at start-up the old one is removed: its folder, shortcuts, entry in the installed
//! apps and its autostart (moved to the new name). Settings, history and level stay: they live
//! under the app identifier, which did not change.
//!
//! An installer run by an update (`/UPDATE`) never creates shortcuts: it expects them to exist.
//! After the rename they did not (the old ones pointed to « Booffer »), so the app was installed
//! but nowhere to be found. `ensure_shortcuts` puts them back at every start.

#[cfg(windows)]
pub fn remove_old_install() {
    use std::path::PathBuf;
    use std::time::Duration;
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, RegDeleteTreeW, HKEY_CURRENT_USER};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    std::thread::spawn(|| {
        // The old instance was just stopped (lib.rs): give Windows a moment to release its files.
        std::thread::sleep(Duration::from_secs(3));
        let Ok(exe) = std::env::current_exe() else { return };
        ensure_shortcuts(&exe, false);

        let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else { return };
        let old_dir = local.join("Booffer");
        if !old_dir.join("booffer.exe").exists() || exe.starts_with(&old_dir) {
            return;
        }

        unsafe {
            // Autostart: the old entry goes, the new one takes its place if it was on.
            let run = wide(r"Software\Microsoft\Windows\CurrentVersion\Run");
            let had_autostart = RegDeleteKeyValueW(HKEY_CURRENT_USER, run.as_ptr(), wide("Booffer").as_ptr()) == 0;
            if had_autostart {
                let _ = crate::autostart::set_autostart(true);
            }
            // « Applications installées » and the installer's own key.
            RegDeleteTreeW(HKEY_CURRENT_USER, wide(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Booffer").as_ptr());
            RegDeleteTreeW(HKEY_CURRENT_USER, wide(r"Software\booffer\Booffer").as_ptr());
        }

        // The old shortcuts go; a desktop one comes back under the new name.
        let desktop = std::env::var_os("USERPROFILE").map(|d| PathBuf::from(d).join(r"Desktop\Booffer.lnk"));
        let had_desktop = desktop.as_ref().is_some_and(|p| p.exists());
        let shortcuts = [
            std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs\Booffer.lnk")),
            desktop,
        ];
        for path in shortcuts.into_iter().flatten() {
            let _ = std::fs::remove_file(path);
        }
        let _ = std::fs::remove_dir_all(&old_dir);
        ensure_shortcuts(&exe, had_desktop);
    });
}

/// Installed copy (an `uninstall.exe` sits next to it) without its Start menu shortcut: creates it,
/// and the desktop one too when `desktop`. The portable exe is left alone.
#[cfg(windows)]
fn ensure_shortcuts(exe: &std::path::Path, desktop: bool) {
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Some(dir) = exe.parent() else { return };
    if !dir.join("uninstall.exe").exists() {
        return;
    }
    let mut links: Vec<PathBuf> = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        links.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs\Boofer.lnk"));
    }
    if desktop {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            links.push(PathBuf::from(home).join(r"Desktop\Boofer.lnk"));
        }
    }
    // PowerShell single-quoted strings: a quote is written twice.
    let quote = |p: &std::path::Path| format!("'{}'", p.display().to_string().replace('\'', "''"));
    for link in links.into_iter().filter(|l| !l.exists()) {
        let script = format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut({});$s.TargetPath={};$s.WorkingDirectory={};$s.Save()",
            quote(&link),
            quote(exe),
            quote(dir),
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

#[cfg(not(windows))]
pub fn remove_old_install() {}

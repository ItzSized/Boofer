//! « Booffer » (two f) became « Boofer ». The installer under the new name installs next to the
//! old copy, so at start-up the old one is removed: its folder, shortcuts, entry in the installed
//! apps and its autostart (moved to the new name). Settings, history and level stay: they live
//! under the app identifier, which did not change.

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
        let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) else { return };
        let old_dir = local.join("Booffer");
        let Ok(exe) = std::env::current_exe() else { return };
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

        let shortcuts = [
            std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(r"Microsoft\Windows\Start Menu\Programs\Booffer.lnk")),
            std::env::var_os("USERPROFILE").map(|d| PathBuf::from(d).join(r"Desktop\Booffer.lnk")),
        ];
        for path in shortcuts.into_iter().flatten() {
            let _ = std::fs::remove_file(path);
        }
        let _ = std::fs::remove_dir_all(&old_dir);
    });
}

#[cfg(not(windows))]
pub fn remove_old_install() {}

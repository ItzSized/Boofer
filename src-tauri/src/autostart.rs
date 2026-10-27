//! "Lancer au démarrage":
//! - Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Booffer
//! - macOS:   ~/Library/LaunchAgents/dev.booffer.desktop.plist
//! - Linux:   ~/.config/autostart/booffer.desktop

#[tauri::command]
pub fn get_autostart() -> bool {
    os::enabled()
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    os::set(enabled)
}

#[cfg(windows)]
mod os {
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
    };

    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE_NAME: &str = "Booffer";
    const ERROR_FILE_NOT_FOUND: u32 = 2;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    pub fn enabled() -> bool {
        let (key, name) = (wide(RUN_KEY), wide(VALUE_NAME));
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        status == 0
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        let (key, name) = (wide(RUN_KEY), wide(VALUE_NAME));
        let status = if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let command = wide(&format!("\"{}\"", exe.display()));
            unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    key.as_ptr(),
                    name.as_ptr(),
                    REG_SZ,
                    command.as_ptr().cast(),
                    (command.len() * 2) as u32,
                )
            }
        } else {
            unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) }
        };
        match status {
            0 => Ok(()),
            ERROR_FILE_NOT_FOUND if !enabled => Ok(()),
            code => Err(format!("le registre a refusé (code {code})")),
        }
    }
}

#[cfg(target_os = "macos")]
mod os {
    use std::path::PathBuf;

    fn plist_path() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("LaunchAgents")
                .join("dev.booffer.desktop.plist")
        })
    }

    pub fn enabled() -> bool {
        plist_path().is_some_and(|p| p.exists())
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        let path = plist_path().ok_or("dossier HOME introuvable")?;
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let plist = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.booffer.desktop</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
                exe.display()
            );
            std::fs::write(path, plist).map_err(|e| e.to_string())
        } else if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
mod os {
    use std::path::PathBuf;

    fn desktop_path() -> Option<PathBuf> {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|cfg| cfg.join("autostart").join("booffer.desktop"))
    }

    pub fn enabled() -> bool {
        desktop_path().is_some_and(|p| p.exists())
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        let path = desktop_path().ok_or("dossier ~/.config introuvable")?;
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let entry = format!(
                "[Desktop Entry]\nType=Application\nName=Booffer\nComment=Compagnon IA sur ton bureau\nExec=\"{}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
                exe.display()
            );
            std::fs::write(path, entry).map_err(|e| e.to_string())
        } else if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
mod os {
    pub fn enabled() -> bool {
        false
    }
    pub fn set(_: bool) -> Result<(), String> {
        Err("plateforme non supportée".into())
    }
}

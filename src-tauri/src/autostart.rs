//! "Lancer au démarrage de Windows": a value under HKCU\…\Run pointing at this exe.
//! Windows is the source of truth, so it isn't duplicated in settings.json.

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

#[cfg(not(windows))]
mod os {
    pub fn enabled() -> bool {
        false
    }
    pub fn set(_: bool) -> Result<(), String> {
        Err("disponible seulement sur Windows".into())
    }
}

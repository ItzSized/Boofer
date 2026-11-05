// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Sets an environment variable unless the user already chose a value.
#[cfg(target_os = "linux")]
fn default_env(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        std::env::set_var(key, value);
    }
}

fn main() {
    // Before GTK starts. Wayland doesn't let an app place itself, stay above the others or know
    // where the cursor is outside its window, so the ghost needs X11 (XWayland on a Wayland desktop).
    #[cfg(target_os = "linux")]
    {
        default_env("GDK_BACKEND", "x11");
        // WebKitGTK's DMA-BUF renderer gives black windows on many drivers.
        default_env("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    boofer_lib::run()
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::default_env;

    #[test]
    fn default_env_keeps_what_the_user_set() {
        std::env::remove_var("BOOFER_TEST_UNSET");
        default_env("BOOFER_TEST_UNSET", "x11");
        assert_eq!(std::env::var("BOOFER_TEST_UNSET").as_deref(), Ok("x11"));

        std::env::set_var("BOOFER_TEST_SET", "wayland");
        default_env("BOOFER_TEST_SET", "x11");
        assert_eq!(std::env::var("BOOFER_TEST_SET").as_deref(), Ok("wayland"));

        std::env::set_var("BOOFER_TEST_EMPTY", "");
        default_env("BOOFER_TEST_EMPTY", "x11");
        assert_eq!(std::env::var("BOOFER_TEST_EMPTY").as_deref(), Ok(""));
    }
}

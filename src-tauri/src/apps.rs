//! Which AI apps are open right now ("🟢 Live" page), from the Windows process list.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningApp {
    name: &'static str,
    processes: u32,
    memory_mb: u64,
}

/// Executable name (lowercase) → name shown.
const KNOWN: &[(&str, &str)] = &[
    ("claude.exe", "Claude Code"),
    ("antigravity.exe", "Antigravity"),
    ("codex.exe", "Codex"),
    ("cursor.exe", "Cursor"),
    ("code.exe", "VS Code"),
    ("windsurf.exe", "Windsurf"),
];

#[tauri::command]
pub async fn running_apps() -> Vec<RunningApp> {
    tauri::async_runtime::spawn_blocking(list).await.unwrap_or_default()
}

#[cfg(windows)]
fn list() -> Vec<RunningApp> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(out) = std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    let mut apps: Vec<RunningApp> = Vec::new();
    // "Image Name","PID","Session Name","Session#","Mem Usage" — memory is localized ("12 345 Ko").
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let fields: Vec<&str> = line.split("\",\"").map(|f| f.trim_matches('"')).collect();
        let Some(image) = fields.first().map(|f| f.to_lowercase()) else { continue };
        let Some(&(_, name)) = KNOWN.iter().find(|(exe, _)| *exe == image) else { continue };
        let kb: u64 = fields.get(4).map(|m| m.chars().filter(char::is_ascii_digit).collect::<String>()).and_then(|d| d.parse().ok()).unwrap_or(0);
        match apps.iter_mut().find(|a| a.name == name) {
            Some(app) => {
                app.processes += 1;
                app.memory_mb += kb / 1024;
            }
            None => apps.push(RunningApp { name, processes: 1, memory_mb: kb / 1024 }),
        }
    }
    apps.sort_by(|a, b| b.memory_mb.cmp(&a.memory_mb));
    apps
}

#[cfg(not(windows))]
fn list() -> Vec<RunningApp> {
    Vec::new()
}

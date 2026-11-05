//! Which AI apps are open right now ("🟢 Live" page), from the process list of the system.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningApp {
    name: &'static str,
    processes: u32,
    memory_mb: u64,
}

/// Executable name (lowercase) → name shown.
#[cfg(windows)]
const KNOWN: &[(&str, &str)] = &[
    ("claude.exe", "Claude Code"),
    ("antigravity.exe", "Antigravity"),
    ("codex.exe", "Codex"),
    ("cursor.exe", "Cursor"),
    ("code.exe", "VS Code"),
    ("windsurf.exe", "Windsurf"),
];

/// The same apps under Linux: process name or executable name → name shown.
#[cfg(target_os = "linux")]
const KNOWN: &[(&str, &str)] = &[
    ("claude", "Claude Code"),
    ("antigravity", "Antigravity"),
    ("codex", "Codex"),
    ("cursor", "Cursor"),
    ("code", "VS Code"),
    ("windsurf", "Windsurf"),
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

#[cfg(target_os = "linux")]
fn list() -> Vec<RunningApp> {
    scan_proc(std::path::Path::new("/proc"))
}

/// One `<root>/<pid>/` per process: `comm` (cut at 15 characters), `exe` (a link to the program,
/// unreadable for another user's processes) and `status` (its memory).
#[cfg(target_os = "linux")]
fn scan_proc(root: &std::path::Path) -> Vec<RunningApp> {
    let mut apps: Vec<RunningApp> = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else { return apps };
    for entry in entries.flatten() {
        if !entry.file_name().to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        // Read one by one: a process can end at any moment, and then it just doesn't count.
        let dir = entry.path();
        let comm = std::fs::read_to_string(dir.join("comm")).unwrap_or_default();
        let exe = std::fs::read_link(dir.join("exe")).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        let Some(name) = known_app(&comm, &exe) else { continue };
        // No memory line: a kernel thread or a zombie, not an open app.
        let Some(kb) = std::fs::read_to_string(dir.join("status")).ok().as_deref().and_then(rss_kb) else { continue };
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

/// The app a process belongs to, from `comm` then the file name of `exe`. The link ends in
/// " (deleted)" when the program was upgraded while running.
#[cfg(target_os = "linux")]
fn known_app(comm: &str, exe: &str) -> Option<&'static str> {
    let program = exe.trim_end_matches(" (deleted)").rsplit('/').next().unwrap_or("");
    let is = |candidate: &str| KNOWN.iter().find(|(known, _)| *known == candidate.to_lowercase()).map(|&(_, name)| name);
    is(comm.trim()).or_else(|| is(program))
}

/// `VmRSS:     12345 kB` in `/proc/<pid>/status`.
#[cfg(target_os = "linux")]
fn rss_kb(status: &str) -> Option<u64> {
    let line = status.lines().find_map(|l| l.strip_prefix("VmRSS:"))?;
    line.split_whitespace().next()?.parse().ok()
}

#[cfg(not(any(windows, target_os = "linux")))]
fn list() -> Vec<RunningApp> {
    Vec::new()
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn fake_process(root: &Path, pid: &str, comm: &str, exe: Option<&str>, status: &str) {
        let dir = root.join(pid);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("comm"), format!("{comm}\n")).unwrap();
        std::fs::write(dir.join("status"), status).unwrap();
        if let Some(exe) = exe {
            std::os::unix::fs::symlink(exe, dir.join("exe")).unwrap();
        }
    }

    fn fake_proc(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("boofer-proc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn finds_the_ai_apps_in_a_fake_proc() {
        let root = fake_proc("apps");
        fake_process(&root, "100", "code", Some("/usr/share/code/code"), "Name:\tcode\nVmRSS:\t  204800 kB\n");
        fake_process(&root, "101", "code", Some("/usr/share/code/code (deleted)"), "VmRSS:\t  102400 kB\n");
        fake_process(&root, "200", "claude", Some("/home/me/.local/share/claude/versions/2.1.0"), "VmRSS:\t   51200 kB\n");
        // Found by its executable, its process name being something else.
        fake_process(&root, "300", "MainThread", Some("/opt/Windsurf/windsurf"), "VmRSS:\t  512000 kB\n");
        // Unreadable executable: the process name is enough.
        fake_process(&root, "400", "cursor", None, "VmRSS:\t    1024 kB\n");
        // Not an AI app.
        fake_process(&root, "500", "firefox", Some("/usr/lib/firefox/firefox"), "VmRSS:\t  999999 kB\n");
        // A zombie or kernel thread has no VmRSS.
        fake_process(&root, "600", "codex", None, "Name:\tcodex\nState:\tZ (zombie)\n");
        // Other entries of /proc are not processes.
        std::fs::create_dir_all(root.join("self")).unwrap();
        std::fs::write(root.join("self").join("comm"), "code\n").unwrap();
        std::fs::write(root.join("self").join("status"), "VmRSS:\t 999999 kB\n").unwrap();

        let apps = scan_proc(&root);
        std::fs::remove_dir_all(&root).unwrap();

        let found: Vec<(&str, u32, u64)> = apps.iter().map(|a| (a.name, a.processes, a.memory_mb)).collect();
        assert_eq!(found, [("Windsurf", 1, 500), ("VS Code", 2, 300), ("Claude Code", 1, 50), ("Cursor", 1, 1)]);
    }

    #[test]
    fn no_proc_means_no_apps() {
        assert!(scan_proc(Path::new("/boofer/no/such/dir")).is_empty());
    }

    #[test]
    fn reads_the_memory_line() {
        assert_eq!(rss_kb("Name:\tx\nVmRSS:\t    1234 kB\nVmData:\t 5 kB\n"), Some(1234));
        assert_eq!(rss_kb("Name:\tx\n"), None);
    }
}

//! User settings: stored as JSON in the app config folder, shared with every window.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalSize, Manager};

use crate::pet::PetState;

/// Window size at `size: 1.0`, in logical px.
pub const BASE_WINDOW: (f64, f64) = (248.0, 440.0);

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// "editor": only on top of `target_apps` windows. "everywhere": always, anywhere on the desktop.
    pub display: String,
    /// Substrings of executable names, lowercase ("antigravity", "code", "cursor"…).
    pub target_apps: Vec<String>,
    /// « Suis-moi » : hops onto whatever window is in front, from app to app.
    pub follow: bool,
    /// Glides toward the mouse cursor when it goes far.
    pub glide: bool,
    pub sounds: bool,
    pub volume: f64,
    pub size: f64,
    pub skin: String,
    pub accessory: String,
    /// Seconds without mouse movement before the ghost falls asleep; 0 = never.
    pub sleep_after: u64,
    pub approvals: bool,
    /// "auto" (follows Windows), "light" or "dark".
    pub theme: String,
    /// Ne pas déranger: no sounds, no permission cards.
    pub dnd: bool,
    /// When « Ne pas déranger » turns itself off (Unix ms, checked by the ghost window); 0 = never.
    pub dnd_until: u64,
    /// Little lines in a speech bubble ("Coucou !", "Tadaa !").
    pub speech: bool,
    /// Windows notification when a task ends while the editor isn't in front.
    pub notifications: bool,
    /// « Stop ! » : dangerous commands from Claude Code wait for a confirmation.
    pub guard: bool,
    /// Daily token budget per model family ("anthropic", "google", "openai"); absent = no limit.
    /// Replaced by `daily_limit_pct`, kept so older settings files still load.
    pub daily_limits: std::collections::BTreeMap<String, u64>,
    /// Daily limit per family as a % of its average over the last 7 days (100 = « comme d'habitude »).
    pub daily_limit_pct: std::collections::BTreeMap<String, u64>,
    /// Ctrl+Alt+P rewrites the prompt with Claude Haiku instead of the local compressor.
    pub reprompt_ai: bool,
    /// When a task ends and no sound can be heard (Boofer's sounds off, or the PC muted),
    /// a Windows notification shows even with the editor in front.
    pub notify_when_silent: bool,
    /// Animation groups switched off ("float", "work", "arms", "celebrate", "tricks", "blink", "sleep"),
    /// or "all".
    pub animations_off: Vec<String>,
    /// Downloads and installs a new release by itself (checked at launch and every few hours).
    pub auto_update: bool,
    /// « ChatGPT, Gemini… (navigateur) » was added to the editors once (0.3.8); unchecking it sticks.
    pub web_ai_added: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            display: "editor".into(),
            target_apps: vec!["antigravity".into(), "agy".into(), "code".into(), "cursor".into(), "web-ai".into()],
            follow: false,
            glide: false,
            sounds: true,
            volume: 0.8,
            size: 1.0,
            skin: "classique".into(),
            accessory: "aucun".into(),
            sleep_after: 45,
            approvals: true,
            theme: "auto".into(),
            dnd: false,
            dnd_until: 0,
            speech: true,
            notifications: true,
            guard: true,
            daily_limits: Default::default(),
            daily_limit_pct: Default::default(),
            reprompt_ai: false,
            notify_when_silent: true,
            animations_off: Vec::new(),
            auto_update: true,
            web_ai_added: true,
        }
    }
}

impl Settings {
    /// "follow" was a display mode in 0.1 builds: it is now the « Suis-moi » switch.
    pub fn everywhere(&self) -> bool {
        self.display == "everywhere" || self.display == "follow"
    }

    pub fn follows_windows(&self) -> bool {
        self.follow || self.display == "follow"
    }
}

pub struct SettingsState {
    pub current: Mutex<Settings>,
    /// Bumped on every change, so the pet loop knows when to re-read.
    pub version: AtomicU64,
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> SettingsState {
    let mut settings: Settings = file(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    // The AI chats in the browser count as editors from 0.3.8 on: added once, for older settings.
    if !settings.web_ai_added {
        settings.web_ai_added = true;
        if !settings.target_apps.iter().any(|t| t == "web-ai") {
            settings.target_apps.push("web-ai".into());
        }
    }
    SettingsState { current: Mutex::new(settings), version: AtomicU64::new(0) }
}

/// Saves, applies and broadcasts new settings.
pub fn store(app: &AppHandle, settings: Settings) -> Result<(), String> {
    if let Some(path) = file(app) {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        std::fs::write(path, text).map_err(|e| e.to_string())?;
    }
    let state = app.state::<SettingsState>();
    *state.current.lock().unwrap() = settings.clone();
    state.version.fetch_add(1, Relaxed);
    apply(app, &settings);
    let _ = app.emit("settings-changed", settings);
    Ok(())
}

pub fn update(app: &AppHandle, change: impl FnOnce(&mut Settings)) -> Result<(), String> {
    let mut settings = app.state::<SettingsState>().current.lock().unwrap().clone();
    change(&mut settings);
    store(app, settings)
}

/// Side effects that live in Rust: mouse gliding, window size, tray checkmarks.
pub fn apply(app: &AppHandle, settings: &Settings) {
    app.state::<PetState>().glide.store(settings.glide, Relaxed);
    crate::sync_tray(app, settings);
    if let Some(window) = app.get_webview_window("main") {
        // pet.rs keeps the ghost's feet in place when the size changes.
        let size = settings.size.clamp(0.6, 1.6);
        let _ = window.set_size(LogicalSize::new(BASE_WINDOW.0 * size, BASE_WINDOW.1 * size));
    }
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, SettingsState>) -> Settings {
    state.current.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    store(&app, settings)
}

// ---------- Claude Code hooks ----------

const HOOKS_TEMPLATE: &str = include_str!("../../hooks/claude-code-settings.example.json");
const HOOK_MARKER: &str = "127.0.0.1:47823";

/// A file of the user's that we are about to rewrite: `None` if it doesn't exist yet. Any other
/// failure (locked, not UTF-8 like files saved by Windows PowerShell…) is an error, never an
/// empty file: writing ours over it would erase what the user wrote.
pub(crate) fn read_user_file(path: &Path, name: &str) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{name} illisible, rien n'a été modifié : {e}")),
    }
}

/// Replaces a file of the user's in one step: written next to it, then renamed over it, so a
/// crash or a full disk never leaves it cut in half. A link (dotfiles) stays a link: the file
/// it points to is the one replaced.
pub(crate) fn write_user_file(path: &Path, text: &str) -> Result<(), String> {
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut tmp = target.clone().into_os_string();
    tmp.push(".booffer-tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

pub(crate) fn claude_settings_path() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".claude").join("settings.json"))
}

/// "missing": no Boofer hooks yet. "outdated": installed by an older Boofer (some events
/// are missing, e.g. compaction). "ok": everything is there.
#[tauri::command]
pub fn claude_hooks_status() -> &'static str {
    let Some(root) = claude_settings_path()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    else {
        return "missing";
    };
    let Ok(template) = serde_json::from_str::<serde_json::Value>(HOOKS_TEMPLATE) else { return "ok" };
    let entries: Vec<(&String, &serde_json::Value)> = template["hooks"]
        .as_object()
        .into_iter()
        .flatten()
        .flat_map(|(event, list)| list.as_array().into_iter().flatten().map(move |entry| (event, entry)))
        .collect();
    let installed = entries.iter().filter(|(event, entry)| has_entry(&root["hooks"][event.as_str()], entry)).count();
    match installed {
        0 if !root["hooks"].to_string().contains(HOOK_MARKER) => "missing",
        n if n < entries.len() => "outdated",
        _ => "ok",
    }
}

/// Boofer's endpoint in a hook entry: "/event/claude-code", "/permission", "/guard".
fn endpoint(entry: &serde_json::Value) -> Option<String> {
    let text = entry.to_string();
    let start = text.find(HOOK_MARKER)? + HOOK_MARKER.len();
    Some(text[start..].chars().take_while(|c| !c.is_whitespace() && *c != '"' && *c != '\\').collect())
}

/// Whether `list` (one event's hooks) already holds Boofer's entry for the same endpoint.
fn has_entry(list: &serde_json::Value, entry: &serde_json::Value) -> bool {
    let Some(wanted) = endpoint(entry) else { return true };
    list.as_array().into_iter().flatten().any(|e| endpoint(e).as_deref() == Some(wanted.as_str()))
}

/// Boofer hooks from an older version: add the new events (the user already said yes once).
pub fn upgrade_claude_hooks() {
    if claude_hooks_status() == "outdated" {
        let _ = install_claude_hooks();
    }
}

/// Adds Boofer's hooks to ~/.claude/settings.json, keeping everything else. The file as it
/// was before Boofer's first install is kept next to it as settings.json.booffer-backup.
#[tauri::command]
pub fn install_claude_hooks() -> Result<(), String> {
    install_hooks_at(&claude_settings_path().ok_or("dossier utilisateur introuvable")?)
}

fn install_hooks_at(path: &Path) -> Result<(), String> {
    let existing = read_user_file(path, "~/.claude/settings.json")?;
    let mut root: serde_json::Value = match &existing {
        Some(text) => serde_json::from_str(text).map_err(|e| format!("~/.claude/settings.json illisible : {e}"))?,
        None => serde_json::json!({}),
    };
    let template: serde_json::Value = serde_json::from_str(HOOKS_TEMPLATE).map_err(|e| e.to_string())?;

    let root_obj = root.as_object_mut().ok_or("~/.claude/settings.json n'est pas un objet JSON")?;
    let hooks = root_obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("« hooks » n'est pas un objet")?;

    for (event, entries) in template["hooks"].as_object().into_iter().flatten() {
        let list = hooks.entry(event.clone()).or_insert_with(|| serde_json::json!([]));
        for entry in entries.as_array().into_iter().flatten() {
            if !has_entry(list, entry) {
                if let Some(list) = list.as_array_mut() {
                    list.push(entry.clone());
                }
            }
        }
    }

    if let Some(text) = &existing {
        // Only once: an upgrade (new hooks) must not replace the original with a copy holding ours.
        let backup = path.with_extension("json.booffer-backup");
        let failed = |e: std::io::Error| format!("copie de sauvegarde impossible, rien n'a été modifié : {e}");
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&backup) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(text.as_bytes()) {
                    drop(file); // closed first: Windows won't delete an open file
                    let _ = std::fs::remove_file(&backup);
                    return Err(failed(e));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(failed(e)),
        }
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    write_user_file(path, &(text + "\n"))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A fresh folder in the temp dir, removed at the end of the test.
    pub(crate) struct TempDir(pub PathBuf);

    impl TempDir {
        pub(crate) fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("booffer-test-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// "élève" in Windows-1252, as Windows PowerShell 5.1 writes files: not UTF-8.
    pub(crate) const ANSI: &[u8] = b"{\"permissions\": {\"allow\": [\"Read(C:/Users/\xe9l\xe8ve/**)\"]}}";

    #[test]
    fn leaves_an_unreadable_settings_file_alone() {
        let dir = TempDir::new("unreadable");
        let path = dir.0.join("settings.json");
        std::fs::write(&path, ANSI).unwrap();
        assert!(install_hooks_at(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), ANSI);
        assert!(!path.with_extension("json.booffer-backup").exists());
    }

    #[test]
    fn keeps_the_user_settings_and_the_first_backup() {
        let dir = TempDir::new("backup");
        let path = dir.0.join("settings.json");
        let original = r#"{"model": "opus", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "mine"}]}]}}"#;
        std::fs::write(&path, original).unwrap();
        install_hooks_at(&path).unwrap();
        let installed: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(installed["model"], "opus");
        assert!(installed["hooks"]["Stop"].to_string().contains("mine"));
        assert!(installed["hooks"].to_string().contains(HOOK_MARKER));
        let backup = path.with_extension("json.booffer-backup");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        // An upgrade installs again: the backup still holds the file from before Boofer.
        install_hooks_at(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
    }

    #[test]
    fn creates_the_settings_file_when_there_is_none() {
        let dir = TempDir::new("missing");
        let path = dir.0.join("settings.json");
        install_hooks_at(&path).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains(HOOK_MARKER));
        assert!(!path.with_extension("json.booffer-backup").exists());
        assert!(!dir.0.join("settings.json.booffer-tmp").exists());
    }

    #[test]
    fn finds_the_guard_entry_missing_next_to_the_event_hook() {
        let template: serde_json::Value = serde_json::from_str(HOOKS_TEMPLATE).unwrap();
        let entries = template["hooks"]["PreToolUse"].as_array().unwrap();
        let (guard, event) = (&entries[0], &entries[1]);
        assert_eq!(endpoint(guard).as_deref(), Some("/guard"));
        assert_eq!(endpoint(event).as_deref(), Some("/event/claude-code"));
        let old_install = serde_json::json!([event]);
        assert!(has_entry(&old_install, event));
        assert!(!has_entry(&old_install, guard));
    }
}

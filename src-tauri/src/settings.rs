//! User settings: stored as JSON in the app config folder, shared with every window.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
    /// "follow": on top of whatever window is in front, and moves with you from app to app.
    pub display: String,
    /// Substrings of executable names, lowercase ("antigravity", "code", "cursor"…).
    pub target_apps: Vec<String>,
    pub follow: bool,
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
    /// Little lines in a speech bubble ("Coucou !", "Tadaa !").
    pub speech: bool,
    /// Windows notification when a task ends while the editor isn't in front.
    pub notifications: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            display: "follow".into(),
            target_apps: vec!["antigravity".into(), "agy".into(), "code".into(), "cursor".into()],
            follow: false,
            sounds: true,
            volume: 0.8,
            size: 1.0,
            skin: "classique".into(),
            accessory: "aucun".into(),
            sleep_after: 45,
            approvals: true,
            theme: "auto".into(),
            dnd: false,
            speech: true,
            notifications: true,
        }
    }
}

impl Settings {
    pub fn everywhere(&self) -> bool {
        self.display == "everywhere"
    }

    pub fn follows_windows(&self) -> bool {
        self.display == "follow"
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
    let settings = file(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
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

/// Side effects that live in Rust: follow flag, window size, tray checkmarks.
pub fn apply(app: &AppHandle, settings: &Settings) {
    app.state::<PetState>().follow.store(settings.follow, Relaxed);
    crate::sync_tray(app, settings);
    if let Some(window) = app.get_webview_window("main") {
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

fn claude_settings_path() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".claude").join("settings.json"))
}

/// "missing": no Booffer hooks yet. "outdated": installed by an older Booffer (some events
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
    let ours = |event: &str| root["hooks"][event].to_string().contains(HOOK_MARKER);
    let events: Vec<&String> = template["hooks"].as_object().map(|o| o.keys().collect()).unwrap_or_default();
    match events.iter().filter(|e| ours(e)).count() {
        0 => "missing",
        n if n < events.len() => "outdated",
        _ => "ok",
    }
}

/// Booffer hooks from an older version: add the new events (the user already said yes once).
pub fn upgrade_claude_hooks() {
    if claude_hooks_status() == "outdated" {
        let _ = install_claude_hooks();
    }
}

/// Adds Booffer's hooks to ~/.claude/settings.json, keeping everything else.
/// The previous file is kept next to it as settings.json.booffer-backup.
#[tauri::command]
pub fn install_claude_hooks() -> Result<(), String> {
    let path = claude_settings_path().ok_or("dossier utilisateur introuvable")?;
    let existing = std::fs::read_to_string(&path).ok();
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
        let Some(list) = list.as_array_mut() else { continue };
        let already = list.iter().any(|entry| entry.to_string().contains(HOOK_MARKER));
        if !already {
            list.extend(entries.as_array().into_iter().flatten().cloned());
        }
    }

    if let Some(text) = existing {
        let _ = std::fs::write(path.with_extension("json.booffer-backup"), text);
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&path, text + "\n").map_err(|e| e.to_string())
}

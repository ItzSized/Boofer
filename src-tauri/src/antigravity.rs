//! Live watcher for Antigravity IDE / Antigravity 2.0 sessions.
//! Tails `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl`
//! and emits `agent-event` with `source: "antigravity"` so the ghost reacts in
//! real time when Gemini 4 Argon, f3.8, Flash, etc. are thinking or running tools.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

use crate::usage::{clean_antigravity_model, extract_model_selection};
use crate::RawAgentEvent;

const POLL_INTERVAL: Duration = Duration::from_millis(300);
/// On startup / sync, replay the current turn if modified recently and still mid-turn.
const STARTUP_ACTIVE_WINDOW: Duration = Duration::from_secs(600);

pub struct ConvTracker {
    pub conv_id: String,
    pub offset: u64,
    pub model: String,
    pub project: String,
}

#[derive(Default)]
pub struct AntigravityState {
    pub trackers: Mutex<HashMap<PathBuf, ConvTracker>>,
    pub synced: AtomicBool,
}

#[tauri::command]
pub fn sync_antigravity(app: AppHandle) {
    let state = app.state::<AntigravityState>();
    let mut trackers = state.trackers.lock().unwrap();
    let roots = brain_roots();
    init_or_sync(&app, &roots, &mut trackers);
    state.synced.store(true, Relaxed);
}

pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let roots = brain_roots();
        if roots.is_empty() {
            return;
        }

        // Wait up to 2.5s for the WebView frontend to register its event listener and call sync_antigravity.
        for _ in 0..25 {
            if app.state::<AntigravityState>().synced.load(Relaxed) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        {
            let state = app.state::<AntigravityState>();
            if !state.synced.swap(true, Relaxed) {
                let mut trackers = state.trackers.lock().unwrap();
                init_or_sync(&app, &roots, &mut trackers);
            }
        }

        loop {
            std::thread::sleep(POLL_INTERVAL);
            let state = app.state::<AntigravityState>();
            let mut trackers = state.trackers.lock().unwrap();
            let now = SystemTime::now();

            for root in &roots {
                let Ok(entries) = std::fs::read_dir(root) else { continue };
                for entry in entries.flatten() {
                    let conv_dir = entry.path();
                    let transcript = conv_dir
                        .join(".system_generated")
                        .join("logs")
                        .join("transcript.jsonl");
                    // Opening the file directly bypasses Windows NTFS directory-entry size caching.
                    let Ok(file) = std::fs::File::open(&transcript) else { continue };
                    let Ok(meta) = file.metadata() else { continue };
                    let len = meta.len();

                    let conv_id = conv_dir
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "default".into());

                    let tracker = trackers.entry(transcript.clone()).or_insert_with(|| {
                        let is_recent = meta
                            .modified()
                            .ok()
                            .and_then(|m| now.duration_since(m).ok())
                            .is_some_and(|age| age <= Duration::from_secs(30));
                        let (model, project, last_input_offset, _) = inspect_transcript(&conv_dir, &transcript);
                        ConvTracker {
                            conv_id: conv_id.clone(),
                            offset: if is_recent { last_input_offset } else { len },
                            model,
                            project,
                        }
                    });

                    if len < tracker.offset {
                        tracker.offset = 0;
                    }
                    if len > tracker.offset {
                        read_new_lines(&app, &transcript, tracker);
                    }
                }
            }
        }
    });
}

fn brain_roots() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
    else {
        return Vec::new();
    };
    let gemini = home.join(".gemini");
    vec![
        gemini.join("antigravity").join("brain"),
        gemini.join("antigravity-ide").join("brain"),
    ]
}

fn init_or_sync(app: &AppHandle, roots: &[PathBuf], trackers: &mut HashMap<PathBuf, ConvTracker>) {
    let now = SystemTime::now();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        for entry in entries.flatten() {
            let conv_dir = entry.path();
            let transcript = conv_dir
                .join(".system_generated")
                .join("logs")
                .join("transcript.jsonl");
            let Ok(file) = std::fs::File::open(&transcript) else { continue };
            let Ok(meta) = file.metadata() else { continue };
            let len = meta.len();
            let recently_modified = meta
                .modified()
                .ok()
                .and_then(|m| now.duration_since(m).ok())
                .is_some_and(|age| age <= STARTUP_ACTIVE_WINDOW);

            let conv_id = conv_dir
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "default".into());

            if recently_modified {
                let (model, project, last_input_offset, mid_turn) = inspect_transcript(&conv_dir, &transcript);
                let mut tracker = ConvTracker {
                    conv_id,
                    offset: if mid_turn { last_input_offset } else { len },
                    model,
                    project,
                };
                if mid_turn {
                    read_new_lines(app, &transcript, &mut tracker);
                }
                trackers.insert(transcript, tracker);
            } else {
                trackers.insert(
                    transcript,
                    ConvTracker {
                        conv_id,
                        offset: len,
                        model: "Gemini 4 Argon".into(),
                        project: String::new(),
                    },
                );
            }
        }
    }
}

/// Scans a transcript to extract `(model, project, last_user_input_offset, is_mid_turn)`.
fn inspect_transcript(conv_dir: &Path, path: &Path) -> (String, String, u64, bool) {
    let mut model = String::from("Gemini 4 Argon");
    let mut project = String::new();
    let mut last_user_input_offset = 0u64;
    let mut byte_offset = 0u64;

    let mut last_step_type = String::new();
    let mut last_has_tools = false;
    let mut running_since_input = 0usize;
    let mut sys_msg_since_input = 0usize;
    let mut steps_since_input = 0usize;

    let Ok(file) = std::fs::File::open(path) else {
        return (model, project, 0, false);
    };
    let mut reader = BufReader::new(file);
    let mut line = String::new();

    loop {
        line.clear();
        let line_start = byte_offset;
        let Ok(read) = reader.read_line(&mut line) else { break };
        if read == 0 || !line.ends_with('\n') {
            break;
        }
        byte_offset += read as u64;

        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        let step_type = v["type"].as_str().unwrap_or("");

        if let Some(content) = v["content"].as_str() {
            if let Some(sel) = extract_model_selection(content) {
                model = clean_antigravity_model(&sel, None);
            }
            if let Some(proj) = extract_project_from_content(content) {
                project = proj;
            }
        }
        if let Some(m) = v["model"].as_str().filter(|s| !s.is_empty()) {
            model = clean_antigravity_model(m, Some(&model));
        }
        if project.is_empty() {
            if let Some(calls) = v["tool_calls"].as_array() {
                for tc in calls {
                    if let Some(proj) = extract_project_from_tool_args(&tc["args"]) {
                        project = proj;
                        break;
                    }
                }
            }
        }

        if step_type == "USER_INPUT" {
            last_user_input_offset = line_start;
            running_since_input = 0;
            sys_msg_since_input = 0;
            steps_since_input = 0;
        }
        steps_since_input += 1;
        if v["status"].as_str() == Some("RUNNING") {
            running_since_input += 1;
        }
        if step_type == "SYSTEM_MESSAGE" {
            sys_msg_since_input += 1;
        }

        last_step_type.clear();
        last_step_type.push_str(step_type);
        last_has_tools = v["tool_calls"].as_array().is_some_and(|a| !a.is_empty());
    }

    let task_recently_active = has_recent_task_activity(conv_dir);
    let mid_turn = if steps_since_input == 0 {
        false
    } else if last_step_type == "PLANNER_RESPONSE" {
        last_has_tools || running_since_input > sys_msg_since_input || task_recently_active
    } else {
        true
    };

    (model, project, last_user_input_offset, mid_turn)
}

fn has_recent_task_activity(conv_dir: &Path) -> bool {
    let tasks_dir = conv_dir.join(".system_generated").join("tasks");
    let Ok(entries) = std::fs::read_dir(tasks_dir) else { return false };
    let now = SystemTime::now();
    entries.flatten().any(|e| {
        e.metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age <= Duration::from_secs(8))
    })
}

fn extract_project_from_content(content: &str) -> Option<String> {
    for marker in ["Active Document: ", "- c:\\", "- C:\\", "- /Users/", "- /home/"] {
        let Some(idx) = content.find(marker) else { continue };
        let start = if marker.starts_with("Active") {
            idx + marker.len()
        } else {
            idx + 2
        };
        let rest = &content[start..];
        let end = rest.find(['\r', '\n', '(']).unwrap_or(rest.len());
        let path = rest[..end].trim();
        if let Some(proj) = infer_project_from_path(path) {
            return Some(proj);
        }
    }
    None
}

fn extract_project_from_tool_args(args: &serde_json::Value) -> Option<String> {
    for key in ["Path", "TargetFile", "AbsolutePath", "DirectoryPath"] {
        if let Some(raw) = args[key].as_str() {
            let trimmed = raw.trim_matches('"');
            if let Some(proj) = infer_project_from_path(trimmed) {
                return Some(proj);
            }
        }
    }
    None
}

fn infer_project_from_path(path: &str) -> Option<String> {
    let parts: Vec<&str> = path
        .split(['\\', '/'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }
    if let Some(idx) = parts.iter().position(|p| {
        matches!(
            p.to_ascii_lowercase().as_str(),
            "dev" | "projects" | "repos" | "workspace" | "workspaces"
        )
    }) {
        if let Some(project) = parts.get(idx + 1) {
            return Some((*project).to_string());
        }
    }
    None
}

fn read_new_lines(app: &AppHandle, path: &Path, tracker: &mut ConvTracker) {
    let Ok(mut file) = std::fs::File::open(path) else { return };
    if file.seek(SeekFrom::Start(tracker.offset)).is_err() {
        return;
    }
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    loop {
        line.clear();
        let Ok(read) = reader.read_line(&mut line) else { break };
        if read == 0 || !line.ends_with('\n') {
            break;
        }
        tracker.offset += read as u64;
        let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if let Some(content) = payload["content"].as_str() {
            if let Some(sel) = extract_model_selection(content) {
                tracker.model = clean_antigravity_model(&sel, None);
            }
            if let Some(proj) = extract_project_from_content(content) {
                tracker.project = proj;
            }
        }
        if let Some(m) = payload["model"].as_str().filter(|s| !s.is_empty()) {
            tracker.model = clean_antigravity_model(m, Some(&tracker.model));
        }
        if tracker.project.is_empty() {
            if let Some(calls) = payload["tool_calls"].as_array() {
                for tc in calls {
                    if let Some(proj) = extract_project_from_tool_args(&tc["args"]) {
                        tracker.project = proj;
                        break;
                    }
                }
            }
        }
        if let Some(obj) = payload.as_object_mut() {
            obj.entry("session_id".to_string())
                .or_insert_with(|| serde_json::Value::String(tracker.conv_id.clone()));
            obj.insert("_model".to_string(), serde_json::Value::String(tracker.model.clone()));
            if !tracker.project.is_empty() {
                obj.insert(
                    "_project".to_string(),
                    serde_json::Value::String(tracker.project.clone()),
                );
            }
        }
        let _ = app.emit(
            "agent-event",
            RawAgentEvent {
                source: "antigravity".into(),
                payload,
            },
        );
    }
}

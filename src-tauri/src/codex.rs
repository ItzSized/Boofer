//! Live watcher for Codex (desktop app, CLI, IDE extension).
//! Codex writes each session to `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.zst` as it
//! goes; we decode what is there so far and forward the new steps as `agent-event`
//! with `source: "codex"` (see src/agents/codex.js).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};

use crate::RawAgentEvent;

const POLL: Duration = Duration::from_millis(1500);
/// Only files written this recently are looked at.
const ACTIVE: Duration = Duration::from_secs(10 * 60);
/// On startup, a session written this recently may still be mid-turn: replay its current turn.
const REPLAY: Duration = Duration::from_secs(120);

#[derive(Default)]
struct Session {
    len: u64,
    lines: usize,
    id: String,
    project: String,
    model: String,
}

pub fn start_watcher(app: AppHandle) {
    let Some(root) = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|home| PathBuf::from(home).join(".codex").join("sessions"))
        .filter(|root| root.is_dir())
    else {
        return;
    };
    std::thread::spawn(move || {
        let mut sessions: HashMap<PathBuf, Session> = HashMap::new();
        let started = SystemTime::now();
        loop {
            for (path, len, modified) in recent_files(&root) {
                let first = !sessions.contains_key(&path);
                let session = sessions.entry(path.clone()).or_default();
                if session.len == len {
                    continue;
                }
                session.len = len;
                let text = decode_partial(&path);
                let lines: Vec<&str> = text.lines().collect();
                // Complete lines only: the last one may still be cut by the compressor.
                let complete = if text.ends_with('\n') { lines.len() } else { lines.len().saturating_sub(1) };
                let from = if first {
                    let fresh = started.duration_since(modified).map_or(true, |age| age < REPLAY);
                    if fresh { current_turn_start(&lines[..complete]) } else { complete }
                } else {
                    session.lines
                };
                // Session details live at the top: read them even when skipping old lines.
                for line in &lines[..from.min(complete)] {
                    remember(session, line);
                }
                for line in &lines[from.min(complete)..complete] {
                    remember(session, line);
                    if let Some(payload) = step(session, line) {
                        let _ = app.emit("agent-event", RawAgentEvent { source: "codex".into(), payload });
                    }
                }
                session.lines = complete;
            }
            std::thread::sleep(POLL);
        }
    });
}

/// `rollout-*.jsonl.zst` files modified within ACTIVE, with their size and mtime.
fn recent_files(root: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    let now = SystemTime::now();
    let mut found = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            let Ok(modified) = meta.modified() else { continue };
            let recent = now.duration_since(modified).map_or(true, |age| age < ACTIVE);
            let path = entry.path();
            // Folders are YYYY/MM/DD: a folder untouched for a while holds no live session.
            if meta.is_dir() {
                if recent || path.parent() == Some(root) || path.parent().and_then(Path::parent) == Some(root) {
                    pending.push(path);
                }
            } else if recent && path.to_string_lossy().ends_with(".jsonl.zst") {
                found.push((path, meta.len(), modified));
            }
        }
    }
    found
}

/// Everything decodable so far (the end of a file being written may be incomplete).
fn decode_partial(path: &Path) -> String {
    let mut out = Vec::new();
    if let Ok(file) = std::fs::File::open(path) {
        if let Ok(mut decoder) = zstd::stream::read::Decoder::new(file) {
            let mut buf = [0u8; 64 * 1024];
            while let Ok(n) = decoder.read(&mut buf) {
                if n == 0 {
                    break;
                }
                out.extend_from_slice(&buf[..n]);
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Index of the last `task_started` if that turn hasn't ended, else the end.
fn current_turn_start(lines: &[&str]) -> usize {
    for (i, line) in lines.iter().enumerate().rev() {
        if line.contains("\"task_complete\"") || line.contains("\"turn_aborted\"") {
            return lines.len();
        }
        if line.contains("\"task_started\"") {
            return i;
        }
    }
    lines.len()
}

fn remember(session: &mut Session, line: &str) {
    if !(line.contains("\"session_meta\"") || line.contains("\"turn_context\"")) {
        return;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { return };
    let p = &v["payload"];
    match v["type"].as_str() {
        Some("session_meta") => {
            session.id = p["id"].as_str().unwrap_or_default().to_string();
            session.project = p["cwd"]
                .as_str()
                .and_then(|cwd| cwd.rsplit(['\\', '/']).find(|part| !part.is_empty()))
                .unwrap_or_default()
                .to_string();
        }
        Some("turn_context") => {
            if let Some(model) = p["model"].as_str() {
                session.model = model.to_string();
            }
        }
        _ => {}
    }
}

/// One rollout line → what the JS adapter needs, or None for bookkeeping lines.
fn step(session: &Session, line: &str) -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let p = &v["payload"];
    let kind = match (v["type"].as_str()?, p["type"].as_str()) {
        ("event_msg", Some("task_started")) => serde_json::json!({ "kind": "start" }),
        ("event_msg", Some("task_complete")) => serde_json::json!({ "kind": "done" }),
        ("event_msg", Some("turn_aborted")) => serde_json::json!({ "kind": "aborted" }),
        ("compacted", _) => serde_json::json!({ "kind": "compacted" }),
        ("response_item", Some("reasoning")) => serde_json::json!({ "kind": "thinking" }),
        ("response_item", Some("message")) if p["role"] == "user" => {
            let text = p["content"][0]["text"].as_str().unwrap_or_default();
            // Codex's own context blocks (<environment_context>, <recommended_plugins>…) aren't prompts.
            if text.trim_start().starts_with('<') {
                return None;
            }
            serde_json::json!({ "kind": "prompt", "text": text.chars().take(200).collect::<String>() })
        }
        ("response_item", Some("custom_tool_call" | "function_call" | "local_shell_call")) => {
            let input = p["input"].as_str().or(p["arguments"].as_str()).unwrap_or_default();
            serde_json::json!({
                "kind": "tool",
                "name": p["name"].as_str().unwrap_or("outil"),
                "input": input.chars().take(400).collect::<String>(),
            })
        }
        _ => return None,
    };
    let mut payload = kind;
    payload["session_id"] = session.id.clone().into();
    payload["project"] = session.project.clone().into();
    payload["model"] = session.model.clone().into();
    Some(payload)
}

//! GitHub Copilot's chat in VS Code (and VS Code Insiders), with nothing to install. VS Code
//! writes each chat as a .jsonl file of changes in its storage (kind 0 = the whole chat, 1 = a
//! value set at a path "k", 2 = items added at a path): a request added to "requests" starts a
//! task, its "result" (or a finished "modelState") ends it, and a minute without any write ends
//! it too, in case a VS Code version says it differently. Events go out like the browser AIs'
//! ("agent-event", source "web-vscode", see src/agents/web.js).

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::SettingsState;
use crate::RawAgentEvent;

const POLL: Duration = Duration::from_secs(1);
/// New chat files are looked for this often; the known ones are read every second.
const RESCAN: Duration = Duration::from_secs(5);
const QUIET_DONE: Duration = Duration::from_secs(60);
const PROGRESS_EVERY: Duration = Duration::from_secs(3);
/// Chats written to recently are the only ones read every second.
const RECENT: Duration = Duration::from_secs(15 * 60);

struct Turn {
    started: Instant,
    last_write: Instant,
    last_progress: Instant,
    prompt: String,
    model: String,
}

struct Chat {
    offset: u64,
    project: String,
    turn: Option<Turn>,
}

/// VS Code's "User" folders.
fn roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
    let Some(base) = base else { return Vec::new() };
    ["Code", "Code - Insiders"].iter().map(|app| base.join(app).join("User")).collect()
}

/// Every chat file, or only those written to in the last minutes.
fn chat_files(only_recent: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for user in roots() {
        let mut dirs = vec![user.join("globalStorage").join("emptyWindowChatSessions")];
        if let Ok(entries) = std::fs::read_dir(user.join("workspaceStorage")) {
            dirs.extend(entries.flatten().map(|e| e.path().join("chatSessions")));
        }
        for dir in dirs {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.extension().is_some_and(|x| x == "jsonl") {
                    continue;
                }
                let recent = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| SystemTime::now().duration_since(t).ok())
                    .is_some_and(|age| age < RECENT);
                if recent || !only_recent {
                    files.push(path);
                }
            }
        }
    }
    files
}

/// "c%3A" → "c:".
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%' && bytes.len() > i + 2)
            .then(|| std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()))
            .flatten();
        match hex {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The project of a chat: <hash>/chatSessions/<id>.jsonl → <hash>/workspace.json →
/// {"folder": "file:///c%3A/dev/app"} → "app".
fn project_of(chat: &Path) -> String {
    let fallback = || "VS Code".to_string();
    let Some(text) = chat.parent().and_then(Path::parent).and_then(|d| std::fs::read_to_string(d.join("workspace.json")).ok())
    else {
        return fallback();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return fallback() };
    let uri = v["folder"].as_str().or_else(|| v["workspace"].as_str()).unwrap_or("");
    let name = percent_decode(uri.trim_end_matches('/').rsplit('/').next().unwrap_or(""));
    let name = name.trim_end_matches(".code-workspace");
    if name.is_empty() {
        fallback()
    } else {
        name.chars().take(40).collect()
    }
}

/// The whole lines written since `offset` (a line being written is read next time).
fn read_new(path: &Path, offset: &mut u64) -> Vec<serde_json::Value> {
    let Ok(mut file) = std::fs::File::open(path) else { return Vec::new() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if len < *offset {
        *offset = len; // rewritten in one piece: nothing new to tell
        return Vec::new();
    }
    if len == *offset || file.seek(SeekFrom::Start(*offset)).is_err() {
        return Vec::new();
    }
    let mut bytes = Vec::new();
    if (&mut file).take(len - *offset).read_to_end(&mut bytes).is_err() {
        return Vec::new();
    }
    let Some(end) = bytes.iter().rposition(|b| *b == b'\n') else { return Vec::new() };
    *offset += end as u64 + 1;
    String::from_utf8_lossy(&bytes[..end]).lines().filter_map(|line| serde_json::from_str(line).ok()).collect()
}

enum Change {
    NewRequest { prompt: String, model: String },
    Finished,
    Other,
}

fn change(v: &serde_json::Value) -> Change {
    let path: Vec<&serde_json::Value> = v["k"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
    let key = |i: usize| path.get(i).and_then(|p| p.as_str());
    match v["kind"].as_u64() {
        Some(2) if path.len() == 1 && key(0) == Some("requests") => {
            let Some(request) = v["v"].as_array().and_then(|a| a.last()) else { return Change::Other };
            Change::NewRequest {
                prompt: request["message"]["text"].as_str().unwrap_or("").chars().take(200).collect(),
                model: request["modelId"].as_str().unwrap_or("").trim_start_matches("copilot/").to_string(),
            }
        }
        Some(1) if key(0) == Some("requests") && matches!(key(2), Some("result" | "isComplete" | "completedAt")) => Change::Finished,
        // ResponseModelState: 0 pending, 1 complete, 2 cancelled, 3 failed, 4 needs input.
        Some(1) if key(0) == Some("requests") && key(2) == Some("modelState") && v["v"]["value"].as_u64().is_some_and(|s| (1..=3).contains(&s)) => {
            Change::Finished
        }
        _ => Change::Other,
    }
}

pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        if roots().iter().all(|r| !r.exists()) {
            return; // no VS Code on this PC
        }
        let launched = SystemTime::now();
        let mut chats: HashMap<PathBuf, Chat> = HashMap::new();
        // At launch, every chat is known as it is: only what gets written from now on counts.
        for path in chat_files(false) {
            let offset = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let project = project_of(&path);
            chats.insert(path, Chat { offset, project, turn: None });
        }
        let mut files: Vec<PathBuf> = Vec::new();
        let mut last_scan: Option<Instant> = None;
        loop {
            std::thread::sleep(POLL);
            if !app.state::<SettingsState>().current.lock().unwrap().watch_vscode {
                continue;
            }
            let now = Instant::now();
            if last_scan.map_or(true, |t| now.duration_since(t) >= RESCAN) {
                last_scan = Some(now);
                files = chat_files(true);
                for path in &files {
                    if chats.contains_key(path) {
                        continue;
                    }
                    // A chat created since launch is read from its start (its first request is
                    // in it); an older one only from now on.
                    let meta = std::fs::metadata(path).ok();
                    let created = meta.as_ref().and_then(|m| m.created().ok()).is_some_and(|t| t >= launched);
                    let offset = if created { 0 } else { meta.map(|m| m.len()).unwrap_or(0) };
                    chats.insert(path.clone(), Chat { offset, project: project_of(path), turn: None });
                }
            }
            for path in &files {
                let Some(chat) = chats.get_mut(path) else { continue };
                let id = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                for v in read_new(path, &mut chat.offset) {
                    match change(&v) {
                        Change::NewRequest { prompt, model } => {
                            emit(&app, &id, "start", &chat.project, serde_json::json!({ "prompt": prompt, "model": model }));
                            chat.turn = Some(Turn { started: now, last_write: now, last_progress: now, prompt, model });
                        }
                        Change::Finished => {
                            if let Some(turn) = chat.turn.take() {
                                done(&app, &id, &chat.project, &turn, now);
                            }
                        }
                        Change::Other => {
                            if let Some(turn) = chat.turn.as_mut() {
                                turn.last_write = now;
                            }
                        }
                    }
                }
                let quiet = chat.turn.as_ref().is_some_and(|t| now.duration_since(t.last_write) >= QUIET_DONE);
                if quiet {
                    if let Some(turn) = chat.turn.take() {
                        done(&app, &id, &chat.project, &turn, turn.last_write);
                    }
                } else if let Some(turn) = chat.turn.as_mut() {
                    if now.duration_since(turn.last_progress) >= PROGRESS_EVERY {
                        turn.last_progress = now;
                        emit(&app, &id, "progress", &chat.project, serde_json::json!({ "model": turn.model }));
                    }
                }
            }
        }
    });
}

fn done(app: &AppHandle, id: &str, project: &str, turn: &Turn, ended: Instant) {
    let extra = serde_json::json!({
        "tookMs": ended.duration_since(turn.started).as_millis() as u64,
        "promptChars": turn.prompt.chars().count(),
        "model": turn.model,
    });
    emit(app, id, "done", project, extra);
}

fn emit(app: &AppHandle, id: &str, kind: &str, project: &str, extra: serde_json::Value) {
    let mut payload = serde_json::json!({ "id": format!("vs{id}"), "kind": kind, "title": project });
    if let (Some(out), Some(more)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in more {
            out.insert(key.clone(), value.clone());
        }
    }
    let _ = app.emit("agent-event", RawAgentEvent { source: "web-vscode".into(), payload });
}

#[cfg(test)]
mod tests {
    use super::{change, percent_decode, Change};
    use serde_json::json;

    #[test]
    fn reads_the_chat_changes() {
        let start = json!({"kind": 2, "k": ["requests"], "v": [{"message": {"text": "Fix the tests"}, "modelId": "copilot/gpt-5"}]});
        assert!(matches!(change(&start), Change::NewRequest { ref prompt, ref model } if prompt == "Fix the tests" && model == "gpt-5"));
        assert!(matches!(change(&json!({"kind": 1, "k": ["requests", 0, "result"], "v": {}})), Change::Finished));
        assert!(matches!(change(&json!({"kind": 1, "k": ["requests", 2, "modelState"], "v": {"value": 1}})), Change::Finished));
        assert!(matches!(change(&json!({"kind": 1, "k": ["requests", 2, "modelState"], "v": {"value": 0}})), Change::Other));
        assert!(matches!(change(&json!({"kind": 2, "k": ["requests", 0, "response"], "v": []})), Change::Other));
        assert_eq!(percent_decode("c%3A/dev/my%20app"), "c:/dev/my app");
    }
}

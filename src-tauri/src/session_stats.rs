//! Per-session numbers from a Claude Code transcript (~/.claude/projects/…/<session>.jsonl):
//! - what the current task cost: tokens of every model call since it started, subagents included;
//! - what fills the context: characters per kind of content since the last compaction, turned
//!   into tokens and fitted to the real context size of the last reply;
//! - what the chat and its project weigh on disk.
//! Read incrementally (byte offset), like usage.rs. Nothing leaves the PC.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::usage::{claude_projects_dirs, is_claude_transcript, parse_iso_ms};

/// Kinds of context content, in the order they are shown.
const PARTS: [&str; 8] = ["prompts", "replies", "toolCalls", "files", "commands", "search", "otherTools", "summary"];
const PROMPTS: usize = 0;
const REPLIES: usize = 1;
const TOOL_CALLS: usize = 2;
const FILES: usize = 3;
const COMMANDS: usize = 4;
const SEARCH: usize = 5;
const OTHER_TOOLS: usize = 6;
const SUMMARY: usize = 7;
/// An image in the context, in characters (≈ 1 500 tokens).
const IMAGE_CHARS: u64 = 6_000;
/// Rough characters per token for text and code.
const CHARS_PER_TOKEN: u64 = 4;

#[derive(Default)]
struct FileStats {
    offset: u64,
    /// Model call id → (epoch ms, input tokens, output tokens). A call spans several lines.
    calls: HashMap<String, (i64, u64, u64)>,
    /// Characters per part since the last compaction (main thread only).
    chars: [u64; PARTS.len()],
    /// tool_use id → part its result goes to.
    tools: HashMap<String, usize>,
    /// Context size at the last main-thread reply (0 right after a compaction).
    context: u64,
}

#[derive(Default)]
pub struct StatsCache {
    files: Mutex<HashMap<PathBuf, FileStats>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    key: &'static str,
    tokens: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    /// Tokens of the task (since `since_ms`), as counted for the daily limits: input + output.
    task_input: u64,
    task_output: u64,
    task_calls: u64,
    context_tokens: u64,
    /// What fills the context, biggest first; "system" = instructions, tool definitions, CLAUDE.md…
    context_parts: Vec<Part>,
}

#[tauri::command]
pub async fn claude_session_stats(app: AppHandle, transcript_path: String, since_ms: i64) -> Result<SessionStats, String> {
    let path = PathBuf::from(transcript_path);
    if !is_claude_transcript(&path) {
        return Err("transcript outside ~/.claude".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let cache = app.state::<StatsCache>();
        let mut files = cache.files.lock().unwrap();

        // Subagents write their own transcripts next to the session's: <session>/subagents/*.jsonl
        let mut paths = vec![path.clone()];
        if let Ok(dir) = std::fs::read_dir(path.with_extension("").join("subagents")) {
            paths.extend(dir.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "jsonl")));
        }

        let (mut input, mut output, mut calls) = (0, 0, 0);
        for p in &paths {
            let stats = files.entry(p.clone()).or_default();
            read_from(p, stats);
            for (at, i, o) in stats.calls.values() {
                if *at >= since_ms {
                    input += i;
                    output += o;
                    calls += 1;
                }
            }
        }

        let main = &files[&path];
        SessionStats {
            task_input: input,
            task_output: output,
            task_calls: calls,
            context_tokens: main.context,
            context_parts: context_parts(main),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Estimated tokens per part, fitted to the real context size; the rest is the system part.
fn context_parts(stats: &FileStats) -> Vec<Part> {
    let estimated: Vec<u64> = stats.chars.iter().map(|c| c / CHARS_PER_TOKEN).collect();
    let sum: u64 = estimated.iter().sum();
    let total = stats.context;
    // Estimates can overshoot (code tokenizes denser): keep at least 5 % for the system part.
    let scale = if total > 0 && sum > total * 95 / 100 { (total * 95 / 100) as f64 / sum as f64 } else { 1.0 };
    let mut parts: Vec<Part> = PARTS
        .iter()
        .zip(&estimated)
        .map(|(key, t)| Part { key: *key, tokens: (*t as f64 * scale) as u64 })
        .filter(|p| p.tokens > 0)
        .collect();
    let counted: u64 = parts.iter().map(|p| p.tokens).sum();
    if total > counted {
        parts.push(Part { key: "system", tokens: total - counted });
    }
    parts.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    parts
}

fn read_from(path: &Path, stats: &mut FileStats) {
    let Ok(mut file) = std::fs::File::open(path) else { return };
    // The file was replaced or shortened: start over.
    if file.metadata().is_ok_and(|m| m.len() < stats.offset) {
        *stats = FileStats::default();
    }
    if file.seek(SeekFrom::Start(stats.offset)).is_err() {
        return;
    }
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    loop {
        line.clear();
        let Ok(read) = reader.read_line(&mut line) else { break };
        if read == 0 || !line.ends_with('\n') {
            break; // end, or a line still being written: next time
        }
        stats.offset += read as u64;
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        read_line(&v, stats);
    }
}

fn read_line(v: &serde_json::Value, stats: &mut FileStats) {
    // A compaction replaces the whole context with a summary.
    if v["subtype"] == "compact_boundary" || v["compactMetadata"].is_object() {
        stats.chars = Default::default();
        stats.tools.clear();
        stats.context = 0;
        return;
    }
    let sidechain = v["isSidechain"] == true;
    let message = &v["message"];
    match v["type"].as_str() {
        Some("assistant") => {
            let usage = &message["usage"];
            if usage.is_object() {
                let n = |key: &str| usage[key].as_u64().unwrap_or(0);
                let input = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
                let output = n("output_tokens");
                let at = v["timestamp"].as_str().and_then(parse_iso_ms).unwrap_or(0);
                let id = message["id"].as_str().or(v["requestId"].as_str()).unwrap_or_default().to_string();
                let slot = stats.calls.entry(id).or_insert((at, input, output));
                if output > slot.2 {
                    *slot = (at, input, output);
                }
                if !sidechain && message["model"].as_str().is_some_and(|m| !m.starts_with('<')) {
                    stats.context = input + output;
                }
            }
            if sidechain {
                return;
            }
            for block in message["content"].as_array().into_iter().flatten() {
                match block["type"].as_str() {
                    Some("text") => stats.chars[REPLIES] += len(&block["text"]),
                    Some("thinking") => stats.chars[REPLIES] += len(&block["thinking"]),
                    Some("tool_use") => {
                        stats.chars[TOOL_CALLS] += block["input"].to_string().len() as u64;
                        if let Some(id) = block["id"].as_str() {
                            stats.tools.insert(id.to_string(), tool_part(block["name"].as_str().unwrap_or("")));
                        }
                    }
                    _ => {}
                }
            }
        }
        Some("user") if !sidechain => {
            let part = if v["isCompactSummary"] == true { SUMMARY } else { PROMPTS };
            match &message["content"] {
                serde_json::Value::String(text) => stats.chars[part] += text.len() as u64,
                serde_json::Value::Array(blocks) => {
                    for block in blocks {
                        match block["type"].as_str() {
                            Some("tool_result") => {
                                let to = block["tool_use_id"].as_str().and_then(|id| stats.tools.get(id)).copied().unwrap_or(OTHER_TOOLS);
                                stats.chars[to] += content_chars(&block["content"]);
                            }
                            Some("image") => stats.chars[part] += IMAGE_CHARS,
                            _ => stats.chars[part] += len(&block["text"]),
                        }
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
}

fn tool_part(name: &str) -> usize {
    match name {
        "Read" | "NotebookRead" => FILES,
        "Bash" | "PowerShell" | "BashOutput" => COMMANDS,
        "Grep" | "Glob" | "WebFetch" | "WebSearch" | "LS" => SEARCH,
        _ => OTHER_TOOLS,
    }
}

fn len(v: &serde_json::Value) -> u64 {
    v.as_str().map_or(0, |s| s.len() as u64)
}

/// A tool result: a string, or blocks of text and images.
fn content_chars(content: &serde_json::Value) -> u64 {
    match content {
        serde_json::Value::String(text) => text.len() as u64,
        serde_json::Value::Array(blocks) => blocks
            .iter()
            .map(|b| if b["type"] == "image" { IMAGE_CHARS } else { len(&b["text"]) })
            .sum(),
        _ => 0,
    }
}

/// What a chat and its project weigh on disk, in ~/.claude/projects/<project>/.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    /// The transcript and the chat's own folder (subagents, tool results…).
    chat_bytes: u64,
    /// The whole project folder: all its chats, its memory…
    project_bytes: u64,
    chats: u64,
}

#[tauri::command]
pub async fn claude_disk_usage(transcript_path: String) -> Result<DiskUsage, String> {
    let path = PathBuf::from(transcript_path);
    tauri::async_runtime::spawn_blocking(move || claude_projects_dirs().iter().find_map(|projects| disk_usage(&path, projects)))
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "transcript outside ~/.claude/projects".into())
}

/// `None` unless the transcript sits right in a project folder: the path comes from a hook,
/// and it decides which folder gets walked.
fn disk_usage(transcript: &Path, projects: &Path) -> Option<DiskUsage> {
    let transcript = transcript.canonicalize().ok()?;
    let project = transcript.parent()?;
    if transcript.extension()? != "jsonl" || project.parent()? != projects.canonicalize().ok()? {
        return None;
    }
    let chats = std::fs::read_dir(project)
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .count();
    Some(DiskUsage {
        chat_bytes: size_of(&transcript) + size_of(&transcript.with_extension("")),
        project_bytes: size_of(project),
        chats: chats as u64,
    })
}

/// Bytes of a file or of a whole folder. Links aren't followed: they could lead anywhere.
pub(crate) fn size_of(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() {
        return meta.len();
    }
    std::fs::read_dir(path).map_or(0, |dir| dir.flatten().map(|e| size_of(&e.path())).sum())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::tests::TempDir;
    use serde_json::json;

    fn feed(lines: &[serde_json::Value]) -> FileStats {
        let mut stats = FileStats::default();
        for l in lines {
            read_line(l, &mut stats);
        }
        stats
    }

    #[test]
    fn counts_task_and_context() {
        let stats = feed(&[
            json!({"type":"user","timestamp":"2026-11-02T10:00:00Z","message":{"role":"user","content":"Ajoute un bouton"}}),
            json!({"type":"assistant","timestamp":"2026-11-02T10:00:05Z","message":{"id":"m1","model":"claude-opus-5-5",
                "content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"a.js"}}],
                "usage":{"input_tokens":10,"cache_read_input_tokens":20000,"output_tokens":50}}}),
            json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"x".repeat(4000)}]}}),
        ]);
        assert_eq!(stats.calls.len(), 1);
        assert_eq!(stats.context, 20_060);
        assert_eq!(stats.chars[FILES], 4000);
        let parts = context_parts(&stats);
        assert_eq!(parts.iter().map(|p| p.tokens).sum::<u64>(), 20_060);
        assert_eq!(parts[0].key, "system");
    }

    #[test]
    fn compaction_resets_context_only() {
        let stats = feed(&[
            json!({"type":"assistant","timestamp":"2026-11-02T10:00:05Z","message":{"id":"m1","model":"claude-opus-5-5","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":100,"output_tokens":5}}}),
            json!({"type":"system","subtype":"compact_boundary","compactMetadata":{"durationMs":1000}}),
        ]);
        assert_eq!(stats.context, 0);
        assert_eq!(stats.chars, [0; PARTS.len()]);
        assert_eq!(stats.calls.len(), 1);
    }

    fn write(path: &Path, bytes: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![b'x'; bytes]).unwrap();
    }

    #[test]
    fn weighs_the_chat_and_its_project() {
        let dir = TempDir::new("disk-usage");
        let projects = dir.0.join("projects");
        let project = projects.join("my-project");
        write(&project.join("a.jsonl"), 100);
        write(&project.join("a/subagents/agent-1.jsonl"), 20);
        write(&project.join("a/tool-results/out.txt"), 3);
        write(&project.join("b.jsonl"), 1000);
        write(&project.join("b/subagents/agent-1.jsonl"), 400);
        write(&project.join("memory/MEMORY.md"), 5);
        write(&projects.join("other-project/c.jsonl"), 70_000);

        let usage = disk_usage(&project.join("a.jsonl"), &projects).unwrap();
        assert_eq!(usage.chat_bytes, 123); // not the other chat, not the memory
        assert_eq!(usage.project_bytes, 1528); // not the other project
        assert_eq!(usage.chats, 2); // the transcripts of the subagents are not chats
    }

    #[test]
    fn only_walks_a_project_folder() {
        let dir = TempDir::new("disk-usage-outside");
        let projects = dir.0.join("projects");
        write(&projects.join("my-project/a.jsonl"), 1);
        write(&projects.join("my-project/a/subagents/agent-1.jsonl"), 1);
        write(&projects.join("my-project/notes.txt"), 1);
        write(&projects.join("loose.jsonl"), 1);
        write(&dir.0.join("outside.jsonl"), 1);

        assert!(disk_usage(&projects.join("my-project/a.jsonl"), &projects).is_some());
        for path in [
            projects.join("my-project/a/subagents/agent-1.jsonl"), // would count a chat's folder as a project
            projects.join("my-project/notes.txt"),
            projects.join("loose.jsonl"), // would walk every project
            dir.0.join("outside.jsonl"),
            projects.join("my-project/gone.jsonl"),
        ] {
            assert!(disk_usage(&path, &projects).is_none(), "{}", path.display());
        }
    }
}

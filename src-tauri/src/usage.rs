//! Usage per AI model, read from the local files of each tool. Nothing leaves the PC.
//!
//! - Claude Code: ~/.claude/projects/**/*.jsonl (model + usage on assistant messages)
//! - Codex:       ~/.codex/sessions/**/*.jsonl.zst (model per turn, token_count events, plan limits)
//! - Antigravity: ~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl
//!                + ~/.gemini/antigravity(-ide)/conversations/*.db (Gemini 3.1 Pro, 4 Argon, Flash…)
//!
//! Files are cached by size + mtime; growing transcripts are read from where we stopped.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Default, Clone, Copy)]
struct Counts {
    calls: u64,
    input: u64,
    output: u64,
}

impl Counts {
    fn add(&mut self, other: Counts) {
        self.calls += other.calls;
        self.input += other.input;
        self.output += other.output;
    }
}

/// (tool, model, local day "YYYY-MM-DD") → counts
type Buckets = HashMap<(String, String, String), Counts>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRow {
    tool: String,
    model: String,
    day: String,
    calls: u64,
    input: u64,
    output: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    tool: String,
    window_minutes: u64,
    used_percent: f64,
    resets_at: Option<i64>,
    /// When this reading was taken (epoch ms): limits are only as fresh as the last session.
    seen_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    rows: Vec<UsageRow>,
    limits: Vec<Limit>,
}

#[derive(Default)]
struct ClaudeFile {
    offset: u64,
    /// message id → (model, day, counts); a message is written once per content block.
    messages: HashMap<String, (String, String, Counts)>,
    /// How long each context compaction of this session took (ms).
    compactions: Vec<u64>,
}

struct CachedFile {
    stamp: (u64, SystemTime),
    buckets: Buckets,
    limits: Vec<Limit>,
    model_hint: Option<String>,
    has_tokens: bool,
}

#[derive(Default)]
pub struct UsageCache {
    claude: Mutex<HashMap<PathBuf, ClaudeFile>>,
    others: Mutex<HashMap<PathBuf, CachedFile>>,
}

#[tauri::command]
pub async fn model_usage(app: AppHandle, tz_offset_minutes: i64) -> Result<Usage, String> {
    tauri::async_runtime::spawn_blocking(move || compute(&app.state::<UsageCache>(), tz_offset_minutes))
        .await
        .map_err(|e| e.to_string())
}

fn compute(cache: &UsageCache, tz: i64) -> Usage {
    let home = home();
    let mut buckets = Buckets::new();
    let mut limits: Vec<Limit> = Vec::new();

    scan_claude(cache, &home.join(".claude").join("projects"), tz, &mut buckets);

    // Codex sessions (.jsonl.zst)
    for file in walk(&home.join(".codex").join("sessions"), ".jsonl.zst") {
        let Some(stamp) = stamp(&file) else { continue };
        let mut others = cache.others.lock().unwrap();
        let fresh = others.get(&file).is_some_and(|c| c.stamp == stamp);
        if !fresh {
            let (file_buckets, file_limits) = read_codex(&file, tz);
            others.insert(
                file.clone(),
                CachedFile {
                    stamp,
                    buckets: file_buckets,
                    limits: file_limits,
                    model_hint: None,
                    has_tokens: true,
                },
            );
        }
        let cached = &others[&file];
        merge(&mut buckets, &cached.buckets);
        limits.extend(cached.limits.iter().cloned());
    }

    // Antigravity 2.0 brain transcripts + Antigravity 1.0/2.0 SQLite conversation DBs
    scan_antigravity(cache, &home.join(".gemini"), tz, &mut buckets);

    // Keep only the most recent reading for each limit window.
    let mut latest: HashMap<(String, u64), Limit> = HashMap::new();
    for limit in limits {
        let key = (limit.tool.clone(), limit.window_minutes);
        if latest.get(&key).is_none_or(|l| l.seen_at < limit.seen_at) {
            latest.insert(key, limit);
        }
    }

    let rows = buckets
        .into_iter()
        .map(|((tool, model, day), c)| UsageRow { tool, model, day, calls: c.calls, input: c.input, output: c.output })
        .collect();
    Usage { rows, limits: latest.into_values().collect() }
}

// ---------- Claude Code ----------

fn scan_claude(cache: &UsageCache, root: &Path, tz: i64, out: &mut Buckets) {
    let mut files = cache.claude.lock().unwrap();
    for path in walk(root, ".jsonl") {
        let Ok(len) = std::fs::metadata(&path).map(|m| m.len()) else { continue };
        let entry = files.entry(path.clone()).or_default();
        if len < entry.offset {
            *entry = ClaudeFile::default(); // rewritten: start over
        }
        if len > entry.offset {
            read_claude_from(&path, entry, tz);
        }
        for (model, day, counts) in entry.messages.values() {
            out.entry(("Claude Code".into(), model.clone(), day.clone())).or_default().add(*counts);
        }
    }
}

fn read_claude_from(path: &Path, entry: &mut ClaudeFile, tz: i64) {
    let Ok(mut file) = std::fs::File::open(path) else { return };
    if file.seek(SeekFrom::Start(entry.offset)).is_err() {
        return;
    }
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    loop {
        line.clear();
        let Ok(read) = reader.read_line(&mut line) else { break };
        if read == 0 || !line.ends_with('\n') {
            break; // end, or a line still being written: pick it up next time
        }
        entry.offset += read as u64;
        let compact = line.contains("\"compactMetadata\"");
        if !compact && !(line.contains("\"usage\"") && line.contains("\"assistant\"")) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if let Some(ms) = v["compactMetadata"]["durationMs"].as_u64() {
            entry.compactions.push(ms);
            continue;
        }
        let message = &v["message"];
        let Some(model) = message["model"].as_str().filter(|m| !m.starts_with('<')) else { continue };
        let id = message["id"].as_str().or(v["requestId"].as_str()).unwrap_or_default().to_string();
        let usage = &message["usage"];
        let n = |key: &str| usage[key].as_u64().unwrap_or(0);
        let counts = Counts {
            calls: 1,
            input: n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"),
            output: n("output_tokens"),
        };
        let day = v["timestamp"].as_str().and_then(parse_iso_ms).map(|ms| day_key(ms, tz)).unwrap_or_default();
        // Same message on several lines: keep the most complete usage.
        let slot = entry.messages.entry(id).or_insert((model.to_string(), day, counts));
        if counts.output > slot.2.output {
            slot.2 = counts;
        }
    }
}

/// How full a Claude Code session's context is, from the end of its transcript.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInfo {
    model: String,
    tokens: u64,
    window: u64,
    /// Typical duration of a compaction on this PC (median, ms), if any happened yet.
    compact_ms: Option<u64>,
}

/// Only the tail is read: the last main-thread assistant message holds the current context size.
const CONTEXT_TAIL_BYTES: u64 = 2 << 20;

#[tauri::command]
pub async fn claude_context(app: AppHandle, transcript_path: String) -> Result<Option<ContextInfo>, String> {
    let path = PathBuf::from(transcript_path);
    let claude_dir = home().join(".claude");
    let allowed = path.extension().is_some_and(|e| e == "jsonl")
        && path.canonicalize().is_ok_and(|p| claude_dir.canonicalize().is_ok_and(|dir| p.starts_with(dir)));
    if !allowed {
        return Err("transcript hors de ~/.claude".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut info = read_context(&path)?;
        let cache = app.state::<UsageCache>();
        let mut all: Vec<u64> = cache.claude.lock().unwrap().values().flat_map(|f| f.compactions.iter().copied()).collect();
        all.sort_unstable();
        info.compact_ms = all.get(all.len() / 2).copied();
        Some(info)
    })
    .await
    .map_err(|e| e.to_string())
}

fn read_context(path: &Path) -> Option<ContextInfo> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(CONTEXT_TAIL_BYTES))).ok()?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut file, &mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    for line in text.lines().rev() {
        let compact = line.contains("\"compactMetadata\"");
        if !compact && !(line.contains("\"usage\"") && line.contains("\"assistant\"")) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if v["compactMetadata"].is_object() {
            return None; // just compacted: no reply since, the next one tells the new size
        }
        if v["isSidechain"] == true {
            continue;
        }
        let message = &v["message"];
        let Some(model) = message["model"].as_str().filter(|m| !m.starts_with('<')) else { continue };
        let usage = &message["usage"];
        let n = |key: &str| usage[key].as_u64().unwrap_or(0);
        let tokens = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens") + n("output_tokens");
        return Some(ContextInfo { model: model.to_string(), tokens, window: context_window(model, tokens), compact_ms: None });
    }
    None
}

/// 1M for models that run with it here (Opus 5.x, Fable, "[1m]" variants), 200k otherwise.
fn context_window(model: &str, tokens: u64) -> u64 {
    let big = model.contains("[1m]") || model.starts_with("claude-opus-5") || model.starts_with("claude-fable") || tokens > 200_000;
    if big { 1_000_000 } else { 200_000 }
}

// ---------- Codex ----------

fn read_codex(path: &Path, tz: i64) -> (Buckets, Vec<Limit>) {
    let mut buckets = Buckets::new();
    let mut limits = Vec::new();
    let Ok(file) = std::fs::File::open(path) else { return (buckets, limits) };
    let Ok(bytes) = zstd::stream::decode_all(file) else { return (buckets, limits) };
    let text = String::from_utf8_lossy(&bytes);

    let mut model = String::from("codex");
    for line in text.lines() {
        if !(line.contains("turn_context") || line.contains("token_count")) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let payload = &v["payload"];
        if v["type"] == "turn_context" {
            if let Some(m) = payload["model"].as_str() {
                model = m.to_string();
            }
            continue;
        }
        if payload["type"] != "token_count" {
            continue;
        }
        let at = v["timestamp"].as_str().and_then(parse_iso_ms).unwrap_or(0);
        let usage = &payload["info"]["last_token_usage"];
        if usage.is_object() {
            let n = |key: &str| usage[key].as_u64().unwrap_or(0);
            let counts = Counts { calls: 1, input: n("input_tokens"), output: n("output_tokens") };
            buckets.entry(("Codex".into(), model.clone(), day_key(at, tz))).or_default().add(counts);
        }
        for window in ["primary", "secondary"] {
            let w = &payload["rate_limits"][window];
            if let (Some(used), Some(minutes)) = (w["used_percent"].as_f64(), w["window_minutes"].as_u64()) {
                limits.push(Limit {
                    tool: "Codex".into(),
                    window_minutes: minutes,
                    used_percent: used,
                    resets_at: w["resets_at"].as_i64().map(|s| s * 1000),
                    seen_at: at,
                });
            }
        }
    }
    (buckets, limits)
}

// ---------- Antigravity ----------

fn scan_antigravity(cache: &UsageCache, gemini_root: &Path, tz: i64, out: &mut Buckets) {
    let mut conv_models: HashMap<String, String> = HashMap::new();
    let mut token_convs: HashSet<String> = HashSet::new();
    let mut no_token_transcripts: HashMap<String, Buckets> = HashMap::new();

    // 1. Scan brain/<conv-id>/.system_generated/logs/transcript.jsonl
    for dir_name in ["antigravity", "antigravity-ide"] {
        let brain = gemini_root.join(dir_name).join("brain");
        let Ok(entries) = std::fs::read_dir(&brain) else { continue };
        for entry in entries.flatten() {
            let conv_dir = entry.path();
            let conv_id = conv_dir
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if conv_id.is_empty() {
                continue;
            }
            let transcript = conv_dir.join(".system_generated").join("logs").join("transcript.jsonl");
            let Some(stamp) = stamp(&transcript) else { continue };
            let mut others = cache.others.lock().unwrap();
            let fresh = others.get(&transcript).is_some_and(|c| c.stamp == stamp);
            if !fresh {
                let (file_buckets, model_hint, has_tokens) = read_antigravity_transcript(&transcript, tz, stamp.1);
                others.insert(
                    transcript.clone(),
                    CachedFile {
                        stamp,
                        buckets: file_buckets,
                        limits: Vec::new(),
                        model_hint,
                        has_tokens,
                    },
                );
            }
            let cached = &others[&transcript];
            if let Some(m) = &cached.model_hint {
                conv_models.insert(conv_id.clone(), m.clone());
            }
            if cached.has_tokens {
                merge(out, &cached.buckets);
                token_convs.insert(conv_id);
            } else if !cached.buckets.is_empty() {
                no_token_transcripts.insert(conv_id, cached.buckets.clone());
            }
        }
    }

    // 2. Scan conversations/<conv-id>.db
    let mut db_convs: HashSet<String> = HashSet::new();
    for dir_name in ["antigravity", "antigravity-ide"] {
        let convs_dir = gemini_root.join(dir_name).join("conversations");
        for file in walk(&convs_dir, ".db") {
            let conv_id = file
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if token_convs.contains(&conv_id) || db_convs.contains(&conv_id) {
                continue;
            }
            let Some(stamp) = stamp(&file) else { continue };
            let hint = conv_models.get(&conv_id).cloned();
            let mut others = cache.others.lock().unwrap();
            let fresh = others
                .get(&file)
                .is_some_and(|c| c.stamp == stamp && c.model_hint == hint);
            if !fresh {
                let file_buckets = read_antigravity(&file, tz, stamp.1, hint.as_deref());
                others.insert(
                    file.clone(),
                    CachedFile {
                        stamp,
                        buckets: file_buckets,
                        limits: Vec::new(),
                        model_hint: hint,
                        has_tokens: true,
                    },
                );
            }
            let cached = &others[&file];
            if !cached.buckets.is_empty() {
                merge(out, &cached.buckets);
                db_convs.insert(conv_id);
            }
        }
    }

    // 3. Fallback: transcripts that had no token counts and no corresponding .db
    for (conv_id, buckets) in no_token_transcripts {
        if !db_convs.contains(&conv_id) {
            merge(out, &buckets);
        }
    }
}

fn read_antigravity_transcript(path: &Path, tz: i64, modified: SystemTime) -> (Buckets, Option<String>, bool) {
    let mut buckets = Buckets::new();
    let mut current_model: Option<String> = None;
    let mut has_tokens = false;
    let Ok(file) = std::fs::File::open(path) else {
        return (buckets, None, false);
    };
    let fallback_ms = modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let reader = BufReader::new(file);
    for line in reader.lines().map_while(Result::ok) {
        if !(line.contains("Model Selection") || line.contains("PLANNER_RESPONSE")) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if let Some(content) = v["content"].as_str().filter(|_| v["type"] == "USER_INPUT") {
            if let Some(selected) = extract_model_selection(content) {
                current_model = Some(clean_antigravity_model(&selected, None));
            }
        }
        if v["type"] != "PLANNER_RESPONSE" {
            continue;
        }
        if let Some(m) = v["model"].as_str().filter(|s| !s.is_empty()) {
            current_model = Some(clean_antigravity_model(m, current_model.as_deref()));
        }
        let n = |key: &str| v[key].as_u64().unwrap_or(0);
        let input = n("input_tokens") + n("cache_read_tokens") + n("cache_creation_input_tokens");
        let output = n("output_tokens");
        if input > 0 || output > 0 {
            has_tokens = true;
        }
        let at = v["created_at"]
            .as_str()
            .and_then(parse_iso_ms)
            .unwrap_or(fallback_ms);
        let model = current_model
            .clone()
            .unwrap_or_else(|| "Gemini (Antigravity)".into());
        buckets
            .entry(("Antigravity".into(), model, day_key(at, tz)))
            .or_default()
            .add(Counts { calls: 1, input, output });
    }
    (buckets, current_model, has_tokens)
}

fn read_antigravity(path: &Path, tz: i64, modified: SystemTime, model_hint: Option<&str>) -> Buckets {
    let mut buckets = Buckets::new();
    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let Ok(db) = rusqlite::Connection::open_with_flags(path, flags) else { return buckets };
    let Ok(mut query) = db.prepare("SELECT data FROM gen_metadata") else { return buckets };
    let Ok(blobs) = query.query_map([], |row| row.get::<_, Vec<u8>>(0)) else { return buckets };
    let fallback_ms = modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);

    for blob in blobs.flatten() {
        // Field 1 = generation info: 19 = model, 4 = token counts, 9.4.1 = start time (s).
        let Some(info) = proto_bytes(&blob, 1) else { continue };
        let Some(raw_model) = proto_bytes(info, 19).and_then(|b| std::str::from_utf8(b).ok()) else { continue };
        let model = clean_antigravity_model(raw_model, model_hint);
        let tokens = proto_bytes(info, 4).unwrap_or_default();
        let n = |field| proto_varint(tokens, field).unwrap_or(0);
        let at = proto_bytes(info, 9)
            .and_then(|t| proto_bytes(t, 4))
            .and_then(|t| proto_varint(t, 1))
            .map(|s| s as i64 * 1000)
            .unwrap_or(fallback_ms);
        // Approximate mapping of Antigravity's counters: 1 + 5 read (fresh + cached), 2 + 3 written.
        let counts = Counts { calls: 1, input: n(1) + n(5), output: n(2) + n(3) };
        buckets.entry(("Antigravity".into(), model, day_key(at, tz))).or_default().add(counts);
    }
    buckets
}

/// Extracts `"Gemini 3.1 Pro (High)"` from the `<USER_SETTINGS_CHANGE>` notes Antigravity
/// adds to user inputs ("The user changed setting `Model Selection` from A to B. No need…").
/// Only that exact sentence counts: code that merely mentions it is ignored.
pub fn extract_model_selection(text: &str) -> Option<String> {
    const MARKER: &str = "setting `Model Selection` from ";
    let after = &text[text.find(MARKER)? + MARKER.len()..];
    let rest = &after[after.find(" to ")? + 4..];
    // Versions contain dots ("3.1"): the sentence ends at ". " or at the end of the line.
    let end = [rest.find(". "), rest.find(['\n', '\r'])].into_iter().flatten().min().unwrap_or(rest.len());
    let model = rest[..end].trim().trim_end_matches('.').trim_matches('`').trim();
    (!model.is_empty() && !model.eq_ignore_ascii_case("none") && model.len() < 60).then(|| model.to_string())
}

/// Normalizes Antigravity model identifiers (e.g. `f3.8`, `Gemini 4 Argon (Medium)`, `gemini-pro-default`).
/// Internal ids (`gemini-pro-a`) take the name the user picked in the model menu (`hint`)
/// when it is the same kind of model.
pub fn clean_antigravity_model(raw: &str, hint: Option<&str>) -> String {
    let trimmed = raw.trim();
    let base = [" (Medium)", " (High)", " (Low)", " (medium)", " (high)", " (low)"]
        .iter()
        .fold(trimmed, |acc, suffix| acc.strip_suffix(suffix).unwrap_or(acc))
        .trim();
    let lower = base.to_ascii_lowercase();
    let hint = hint.map(|h| clean_antigravity_model(h, None)).filter(|h| !h.is_empty());
    let same_kind = |h: &str| {
        let h = h.to_ascii_lowercase();
        ["pro", "flash", "argon", "opus", "sonnet"].iter().any(|k| lower.contains(k) && h.contains(k))
    };
    match lower.as_str() {
        "f3.8" | "gemini 4 argon" | "gemini-4-argon" | "gemini 4 argon (f3.8)" => "Gemini 4 Argon".into(),
        "gemini 3.8 flash" | "gemini-3.8-flash" | "f3.8-flash" | "f3.8 flash" => "Gemini 3.8 Flash".into(),
        _ if !base.contains(' ') && hint.as_deref().is_some_and(same_kind) => hint.unwrap_or_default(),
        _ => base.to_string(),
    }
}

/// Minimal protobuf reader: first length-delimited value of `field`.
fn proto_bytes(buf: &[u8], field: u64) -> Option<&[u8]> {
    proto_find(buf, field, 2).map(|(_, bytes)| bytes)
}

fn proto_varint(buf: &[u8], field: u64) -> Option<u64> {
    proto_find(buf, field, 0).map(|(value, _)| value)
}

fn proto_find(buf: &[u8], field: u64, want_wire: u64) -> Option<(u64, &[u8])> {
    let mut i = 0;
    while i < buf.len() {
        let key = read_varint(buf, &mut i)?;
        let (number, wire) = (key >> 3, key & 7);
        match wire {
            0 => {
                let value = read_varint(buf, &mut i)?;
                if number == field && want_wire == 0 {
                    return Some((value, &[]));
                }
            }
            2 => {
                let len = read_varint(buf, &mut i)? as usize;
                let bytes = buf.get(i..i.checked_add(len)?)?;
                i += len;
                if number == field && want_wire == 2 {
                    return Some((0, bytes));
                }
            }
            1 => i += 8,
            5 => i += 4,
            _ => return None,
        }
    }
    None
}

fn read_varint(buf: &[u8], i: &mut usize) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *buf.get(*i)?;
        *i += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

// ---------- Helpers ----------

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}

fn stamp(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()?))
}

fn merge(into: &mut Buckets, from: &Buckets) {
    for (key, counts) in from {
        into.entry(key.clone()).or_default().add(*counts);
    }
}

/// Files under `root` whose name ends with `suffix`, recursively.
fn walk(root: &Path, suffix: &str) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.to_string_lossy().ends_with(suffix) {
                found.push(path);
            }
        }
    }
    found
}

/// "2026-09-17T10:42:18.656Z" → epoch ms.
fn parse_iso_ms(text: &str) -> Option<i64> {
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, s) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let millis = text.get(20..23).and_then(|f| f.parse::<i64>().ok()).unwrap_or(0);
    Some(((days_from_civil(y, mo, d) * 24 + h) * 60 + mi) * 60_000 + s * 1000 + millis)
}

/// Local day for an epoch ms, given JS's getTimezoneOffset() (minutes, UTC − local).
fn day_key(ms: i64, tz_offset_minutes: i64) -> String {
    let local = ms - tz_offset_minutes * 60_000;
    let (y, m, d) = civil_from_days(local.div_euclid(86_400_000));
    format!("{y:04}-{m:02}-{d:02}")
}

// Howard Hinnant's date algorithms.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_antigravity_models() {
        let s = "<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 4 Argon (Medium). No need to comment";
        let extracted = extract_model_selection(s).unwrap();
        assert_eq!(extracted, "Gemini 4 Argon (Medium)");
        assert_eq!(clean_antigravity_model(&extracted, None), "Gemini 4 Argon");
        assert_eq!(clean_antigravity_model("f3.8", None), "Gemini 4 Argon");
        assert_eq!(clean_antigravity_model("Gemini 3.5 Flash (Medium)", None), "Gemini 3.5 Flash");
        let s = "The user changed setting `Model Selection` from None to Gemini 3.1 Pro (High). No need to comment";
        assert_eq!(extract_model_selection(s).as_deref(), Some("Gemini 3.1 Pro (High)"));
        assert_eq!(clean_antigravity_model("gemini-pro-default", Some("Gemini 3.1 Pro (High)")), "Gemini 3.1 Pro");
        assert_eq!(clean_antigravity_model("gemini-3.8-flash-n", Some("Gemini 3.1 Pro (High)")), "gemini-3.8-flash-n");
        assert_eq!(extract_model_selection("if line.contains(\"Model Selection\") to x"), None);
    }

    #[test]
    #[ignore = "reads the real files of this machine"]
    fn prints_local_usage() {
        let cache = UsageCache::default();
        let started = std::time::Instant::now();
        let usage = compute(&cache, -120);
        let first = started.elapsed();
        let started = std::time::Instant::now();
        compute(&cache, -120);
        println!("scan: {first:?} (cached: {:?})", started.elapsed());

        let mut totals: HashMap<(String, String), Counts> = HashMap::new();
        for row in &usage.rows {
            let c = Counts { calls: row.calls, input: row.input, output: row.output };
            totals.entry((row.tool.clone(), row.model.clone())).or_default().add(c);
        }
        let mut totals: Vec<_> = totals.into_iter().collect();
        totals.sort_by_key(|(_, c)| std::cmp::Reverse(c.calls));
        for ((tool, model), c) in totals {
            println!("{tool:12} {model:32} calls={:6} in={:12} out={:10}", c.calls, c.input, c.output);
        }
        for l in &usage.limits {
            println!("limit {} {}min {}% resets={:?} seen={}", l.tool, l.window_minutes, l.used_percent, l.resets_at, l.seen_at);
        }
    }
}

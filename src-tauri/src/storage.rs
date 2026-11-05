//! What Claude Code keeps on the disk, project by project (~/.claude/projects/<project>/):
//! the chats (<session>.jsonl), their folders (subagents, tool results…), the memory.
//! Only measures and reads: nothing here writes or deletes in ~/.claude.

use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::session_stats::size_of;
use crate::usage::claude_projects_dirs;

/// A chat title is cut after this many characters.
const TITLE_CHARS: usize = 80;
/// A chat can weigh gigabytes: its title and project are looked for in the start only.
const HEAD_BYTES: u64 = 256 * 1024;
const HEAD_LINES: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStorage {
    id: String,
    /// The transcript and the chat's own folder.
    bytes: u64,
    modified_ms: i64,
    /// The title Claude Code gave the chat, else the first request of the user
    /// ("" when the start of the file has neither).
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStorage {
    /// The folder name of the project, as the user knows it.
    name: String,
    /// The folder in ~/.claude/projects.
    path: String,
    bytes: u64,
    chat_count: u64,
    last_used_ms: i64,
    /// Heaviest first.
    chats: Vec<ChatStorage>,
}

#[tauri::command]
pub async fn claude_storage() -> Result<Vec<ProjectStorage>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut all: Vec<ProjectStorage> = claude_projects_dirs().iter().flat_map(|projects| storage(projects)).collect();
        all.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
        all
    })
    .await
    .map_err(|e| e.to_string())
}

/// Shows a project folder of ~/.claude/projects in the file explorer (only those).
#[tauri::command]
pub fn open_claude_folder(path: String) -> Result<(), String> {
    let folder = claude_projects_dirs()
        .iter()
        .find_map(|projects| project_folder(Path::new(&path), projects))
        .ok_or("folder outside Claude Code's projects")?;
    // canonicalize() gives \\?\C:\… on Windows, which the explorer doesn't take.
    let shown = folder.to_string_lossy();
    crate::open_target(shown.strip_prefix(r"\\?\").unwrap_or(&*shown))
}

/// The folder behind `path`, only if it is a project folder: the path comes from the page,
/// and it decides what gets opened.
fn project_folder(path: &Path, projects: &Path) -> Option<PathBuf> {
    let folder = path.canonicalize().ok()?;
    (folder.is_dir() && folder.parent()? == projects.canonicalize().ok()?).then_some(folder)
}

/// Every project folder of `projects`, heaviest first.
fn storage(projects: &Path) -> Vec<ProjectStorage> {
    let Ok(dir) = std::fs::read_dir(projects) else { return Vec::new() };
    let mut all: Vec<ProjectStorage> = dir
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| project_storage(&e.path()))
        .collect();
    all.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
    all
}

fn project_storage(folder: &Path) -> ProjectStorage {
    let mut chats = Vec::new();
    // The working folder seen in the most recent chat that tells it.
    let mut cwd: Option<(i64, String)> = None;
    for entry in std::fs::read_dir(folder).into_iter().flatten().flatten() {
        let path = entry.path();
        // The transcripts of the subagents are in <session>/subagents/: not chats.
        if !entry.file_type().is_ok_and(|t| t.is_file()) || !path.extension().is_some_and(|x| x == "jsonl") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let modified_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as i64);
        let Head { title, cwd: found } = read_head(&path);
        if let Some(found) = found {
            if cwd.as_ref().map_or(true, |(at, _)| *at < modified_ms) {
                cwd = Some((modified_ms, found));
            }
        }
        chats.push(ChatStorage {
            id: id.to_string(),
            bytes: size_of(&path) + size_of(&path.with_extension("")),
            modified_ms,
            title,
        });
    }
    chats.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.id.cmp(&b.id)));
    ProjectStorage {
        name: cwd.and_then(|(_, c)| last_segment(&c)).unwrap_or_else(|| name_from_folder(folder)),
        path: folder.to_string_lossy().into_owned(),
        bytes: size_of(folder),
        chat_count: chats.len() as u64,
        last_used_ms: chats.iter().map(|c| c.modified_ms).max().unwrap_or(0),
        chats,
    }
}

/// "C:\Users\me\Documents\My-Game\" → "My-Game"; works with / too.
fn last_segment(cwd: &str) -> Option<String> {
    let is_sep = |c: char| c == '/' || c == '\\';
    let name = cwd.trim_end_matches(is_sep).rsplit(is_sep).next()?;
    (!name.is_empty()).then(|| name.to_string())
}

/// Claude Code names the folder after the working folder, every character that isn't a
/// letter or a digit turned into "-": "C--Users-me-My-Game". It can't be turned back
/// ("My-Game" or "My" in "Game"?): only a last resort, when no chat tells the real folder.
fn name_from_folder(folder: &Path) -> String {
    let name = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    name.rsplit('-').find(|s| !s.is_empty()).map_or(name.clone(), str::to_string)
}

struct Head {
    title: String,
    cwd: Option<String>,
}

/// The title and the working folder of a chat, from the start of its transcript.
fn read_head(path: &Path) -> Head {
    let mut head = Head { title: String::new(), cwd: None };
    let Ok(file) = std::fs::File::open(path) else { return head };
    let mut reader = BufReader::new(file.take(HEAD_BYTES));
    let mut line = Vec::new();
    let (mut ai_title, mut first_request) = (None, None);
    for _ in 0..HEAD_LINES {
        line.clear();
        // Bytes, not a String: one line that isn't UTF-8 must not stop the reading.
        if !matches!(reader.read_until(b'\n', &mut line), Ok(n) if n > 0) {
            break;
        }
        // Unreadable, or cut by the size limit: skipped.
        let Ok(v) = serde_json::from_slice::<serde_json::Value>(&line) else { continue };
        if head.cwd.is_none() {
            head.cwd = v["cwd"].as_str().filter(|c| !c.is_empty()).map(str::to_string);
        }
        if ai_title.is_none() && v["type"] == "ai-title" {
            ai_title = v["aiTitle"].as_str().map(str::trim).filter(|t| !t.is_empty()).map(str::to_string);
        }
        if first_request.is_none() {
            first_request = request_text(&v);
        }
        if head.cwd.is_some() && ai_title.is_some() {
            break;
        }
    }
    head.title = ai_title.or(first_request).map(|t| shorten(&t)).unwrap_or_default();
    head
}

/// The text of a line that is a real request of the user; `None` for the rest: answers,
/// tool results, subagents, the summary of a compaction, the messages Claude Code adds
/// itself (meta, <command-name>…, "[Request interrupted…"). In an editor, blocks like
/// <ide_opened_file>… come before the words of the user, in the same message.
fn request_text(v: &serde_json::Value) -> Option<String> {
    if v["type"] != "user" || v["isMeta"] == true || v["isSidechain"] == true || v["isCompactSummary"] == true {
        return None;
    }
    let real = |text: &&str| !text.is_empty() && !text.starts_with('<') && !text.starts_with("[Request interrupted");
    match &v["message"]["content"] {
        serde_json::Value::String(text) => Some(text.trim()).filter(real).map(str::to_string),
        serde_json::Value::Array(blocks) => {
            if blocks.iter().any(|b| b["type"] == "tool_result") {
                return None;
            }
            blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).map(str::trim).find(real).map(str::to_string)
        }
        _ => None,
    }
}

/// One line of at most `TITLE_CHARS` characters, "…" when cut.
fn shorten(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= TITLE_CHARS {
        return flat;
    }
    let cut: String = flat.chars().take(TITLE_CHARS).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::tests::TempDir;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn write(path: &Path, bytes: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![b'x'; bytes]).unwrap();
    }

    /// A transcript made of these lines.
    fn transcript(path: &Path, lines: &[serde_json::Value]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let text: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
        std::fs::write(path, text.join("\n") + "\n").unwrap();
    }

    fn user(text: &str) -> serde_json::Value {
        json!({"type":"user","cwd":"C:\\Users\\me\\Games\\Pong","message":{"role":"user","content":text}})
    }

    fn title_of(lines: &[serde_json::Value]) -> String {
        // Tests run in parallel: one folder per call.
        static CALLS: AtomicUsize = AtomicUsize::new(0);
        let dir = TempDir::new(&format!("storage-title-{}", CALLS.fetch_add(1, Ordering::Relaxed)));
        transcript(&dir.0.join("a.jsonl"), lines);
        read_head(&dir.0.join("a.jsonl")).title
    }

    #[test]
    fn weighs_sorts_and_counts_the_chats() {
        let dir = TempDir::new("storage-weights");
        let projects = dir.0.join("projects");
        let small = projects.join("C--small");
        let big = projects.join("C--big");
        write(&small.join("a.jsonl"), 10);
        write(&big.join("a.jsonl"), 100);
        write(&big.join("a/subagents/agent-1.jsonl"), 20);
        write(&big.join("a/tool-results/out.txt"), 3);
        write(&big.join("b.jsonl"), 500);
        write(&big.join("memory/MEMORY.md"), 5);
        write(&big.join("notes.txt"), 7); // weighs, but is not a chat
        write(&projects.join("loose.jsonl"), 99_999); // not a project folder

        let all = storage(&projects);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].path, big.to_string_lossy()); // heaviest first
        assert_eq!(all[0].bytes, 635);
        assert_eq!(all[1].bytes, 10);
        // The transcripts of the subagents are not chats.
        assert_eq!(all[0].chat_count, 2);
        assert_eq!(all[0].chats.len(), 2);
        // Heaviest chat first; a chat weighs its folder too.
        assert_eq!(all[0].chats[0].id, "b");
        assert_eq!(all[0].chats[0].bytes, 500);
        assert_eq!(all[0].chats[1].id, "a");
        assert_eq!(all[0].chats[1].bytes, 123);
        assert!(all[0].last_used_ms > 0);
    }

    #[test]
    fn a_missing_projects_folder_is_empty() {
        let dir = TempDir::new("storage-missing");
        assert!(storage(&dir.0.join("nothing")).is_empty());
    }

    #[test]
    fn names_the_project_from_the_working_folder() {
        let dir = TempDir::new("storage-name");
        let projects = dir.0.join("projects");
        transcript(&projects.join("C--tmp-abc/a.jsonl"), &[user("hello")]);
        transcript(
            &projects.join("C--Users-me-Other-Game/a.jsonl"),
            &[json!({"type":"user","cwd":"/home/me/other-game/","message":{"content":"hi"}})],
        );
        // No readable chat: the folder name, as a last resort.
        write(&projects.join("C--Users-me-Games-Lost/a.jsonl"), 1);

        let names: Vec<String> = storage(&projects).into_iter().map(|p| p.name).collect();
        assert!(names.contains(&"Pong".to_string()), "{names:?}"); // from the chat, not "abc" from the folder
        assert!(names.contains(&"other-game".to_string()), "{names:?}"); // / and a final separator
        assert!(names.contains(&"Lost".to_string()), "{names:?}");
    }

    #[test]
    fn the_working_folder_wins_over_the_folder_name() {
        let dir = TempDir::new("storage-name-wins");
        let projects = dir.0.join("projects");
        // The folder name says "Incremental": the chat knows it is "Multiverse-Incremental".
        transcript(
            &projects.join("C--Users-me-Multiverse-Incremental/a.jsonl"),
            &[json!({"type":"user","cwd":"C:\\Users\\me\\Multiverse-Incremental","message":{"content":"hi"}})],
        );
        assert_eq!(storage(&projects)[0].name, "Multiverse-Incremental");
    }

    #[test]
    fn the_title_is_the_first_real_request() {
        let title = title_of(&[
            json!({"type":"summary","summary":"old"}),
            json!({"type":"user","isMeta":true,"message":{"content":"Caveat: local commands"}}),
            json!({"type":"user","message":{"content":"<command-name>/clear</command-name>"}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t","content":"result"}]}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t","content":"result"},{"type":"text","text":"Added by a hook"}]}}),
            json!({"type":"user","isSidechain":true,"message":{"content":"Agent task"}}),
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"Sure"}]}}),
            json!({"type":"user","message":{"content":[{"type":"text","text":"Add a  settings\npage"}]}}),
            user("Something else"),
        ]);
        assert_eq!(title, "Add a settings page");
    }

    #[test]
    fn the_title_is_the_one_claude_code_gave_the_chat() {
        let title = title_of(&[
            user("A long first request"),
            json!({"type":"ai-title","aiTitle":"  Fix the login  ","sessionId":"s"}),
            json!({"type":"ai-title","aiTitle":"A later one","sessionId":"s"}),
        ]);
        assert_eq!(title, "Fix the login");
        // An empty one doesn't count.
        assert_eq!(title_of(&[json!({"type":"ai-title","aiTitle":" "}), user("The request")]), "The request");
    }

    #[test]
    fn the_title_skips_what_the_editor_adds_before_the_request() {
        let title = title_of(&[json!({"type":"user","message":{"content":[
            {"type":"image","source":{}},
            {"type":"text","text":"<ide_opened_file>The user opened a file</ide_opened_file>"},
            {"type":"text","text":"  Fix the bubble  "},
            {"type":"text","text":"A later block"},
        ]}})]);
        assert_eq!(title, "Fix the bubble");
        // Tags and nothing else: on to the next message.
        let title = title_of(&[
            json!({"type":"user","message":{"content":[{"type":"text","text":"<pasted_content>x</pasted_content>"}]}}),
            user("The next one"),
        ]);
        assert_eq!(title, "The next one");
    }

    #[test]
    fn the_title_skips_unreadable_lines() {
        let dir = TempDir::new("storage-unreadable");
        let path = dir.0.join("a.jsonl");
        let mut bytes = b"{\"type\":\"user\",\"mess".to_vec();
        bytes.extend_from_slice(b"\nnot json at all\n\xff\xfe\n");
        bytes.extend_from_slice(user("Fix the bug").to_string().as_bytes());
        bytes.push(b'\n');
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(read_head(&path).title, "Fix the bug");
    }

    #[test]
    fn the_title_is_cut_at_80_characters() {
        let exact = "a".repeat(80);
        assert_eq!(title_of(&[user(&exact)]), exact);
        assert_eq!(title_of(&[user(&"a".repeat(81))]), format!("{exact}…"));
        // Characters, not bytes: no cut in the middle of an "é".
        assert_eq!(title_of(&[user(&"é".repeat(90))]), format!("{}…", "é".repeat(80)));
    }

    #[test]
    fn a_chat_without_a_request_has_no_title() {
        assert_eq!(title_of(&[json!({"type":"assistant","message":{"content":[]}})]), "");
    }

    #[test]
    fn only_the_start_of_a_chat_is_read() {
        let dir = TempDir::new("storage-head");
        let request = user("Late request").to_string();

        // Line 200 is read, line 201 is not.
        let path = dir.0.join("lines-ok.jsonl");
        std::fs::write(&path, "{}\n".repeat(HEAD_LINES - 1) + &request + "\n").unwrap();
        assert_eq!(read_head(&path).title, "Late request");
        let path = dir.0.join("lines-late.jsonl");
        std::fs::write(&path, "{}\n".repeat(HEAD_LINES) + &request + "\n").unwrap();
        assert_eq!(read_head(&path).title, "");

        // A first line over the size limit hides what comes after it.
        let path = dir.0.join("bytes-late.jsonl");
        let big = json!({"type":"assistant","pad":"x".repeat(HEAD_BYTES as usize)}).to_string();
        std::fs::write(&path, big + "\n" + &request + "\n").unwrap();
        assert_eq!(read_head(&path).title, "");
    }

    #[test]
    fn opens_only_a_project_folder() {
        let dir = TempDir::new("storage-open");
        let projects = dir.0.join("projects");
        write(&projects.join("my-project/a.jsonl"), 1);
        write(&projects.join("my-project/a/subagents/agent-1.jsonl"), 1);
        write(&projects.join("loose.jsonl"), 1);
        write(&dir.0.join("outside/file.txt"), 1);

        assert!(project_folder(&projects.join("my-project"), &projects).is_some());
        for path in [
            projects.clone(),                                 // would open every project
            projects.join("my-project/a"),                    // a folder inside a project
            projects.join("my-project/a.jsonl"),              // a file
            projects.join("loose.jsonl"),
            projects.join("my-project/../../outside"),        // leaves ~/.claude/projects by ..
            projects.join("my-project/.."),                   // is ~/.claude/projects again
            dir.0.join("outside"),
            dir.0.clone(),
            projects.join("gone"),
        ] {
            assert!(project_folder(&path, &projects).is_none(), "{}", path.display());
        }
    }
}

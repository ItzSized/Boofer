//! « Économiser des tokens » (settings → ✂️ Tokens):
//! - compact earlier: Claude Code's `autoCompactWindow` setting caps the context it keeps
//!   (it re-reads the whole context at every message, so a smaller one costs less);
//! - concise answers: a marked block in ~/.claude/CLAUDE.md;
//! - prompt compression with Claude Haiku (the local, free one is in src/core/compress.js).

use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::settings::{claude_settings_path, read_user_file, write_user_file};

const CONCISE_START: &str = "<!-- booffer:concise -->";
const CONCISE_END: &str = "<!-- /booffer:concise -->";
const CONCISE_BLOCK: &str = "<!-- booffer:concise -->
## Style des réponses (ajouté par Booffer, à retirer depuis ses réglages)
- Réponds court et direct : pas de récapitulatif final, ne reformule pas la demande.
- Ne réaffiche pas le code inchangé : seulement les lignes modifiées.
- Pas d'explication sauf si on la demande.
<!-- /booffer:concise -->";

/// Folder the Haiku compression runs in: the ghost ignores sessions started there.
const COMPRESS_DIR: &str = "booffer-compress";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenSavers {
    /// Claude Code's `autoCompactWindow` (tokens), if set.
    compact_window: Option<u64>,
    concise: bool,
    /// The `claude` command is installed (for the Haiku compression).
    claude_cli: bool,
}

fn claude_md() -> Option<PathBuf> {
    claude_settings_path().map(|p| p.with_file_name("CLAUDE.md"))
}

fn read_settings() -> Result<serde_json::Value, String> {
    read_settings_at(&claude_settings_path().ok_or("dossier utilisateur introuvable")?)
}

fn read_settings_at(path: &Path) -> Result<serde_json::Value, String> {
    match read_user_file(path, "~/.claude/settings.json")? {
        Some(text) => serde_json::from_str(&text).map_err(|e| format!("~/.claude/settings.json illisible : {e}")),
        None => Ok(serde_json::json!({})),
    }
}

/// Window Claude Code compacts at, if the user set one (used by the context gauge too).
pub fn compact_window() -> Option<u64> {
    read_settings().ok()?["autoCompactWindow"].as_u64()
}

#[tauri::command]
pub fn get_token_savers() -> TokenSavers {
    let concise = claude_md()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .is_some_and(|text| text.contains(CONCISE_START));
    TokenSavers { compact_window: compact_window(), concise, claude_cli: which_claude() }
}

/// `tokens`: 100 000 to 1 000 000, or None to go back to Claude Code's default.
#[tauri::command]
pub fn set_compact_window(tokens: Option<u64>) -> Result<(), String> {
    set_compact_window_at(&claude_settings_path().ok_or("dossier utilisateur introuvable")?, tokens)
}

fn set_compact_window_at(path: &Path, tokens: Option<u64>) -> Result<(), String> {
    let mut root = read_settings_at(path)?;
    let obj = root.as_object_mut().ok_or("~/.claude/settings.json n'est pas un objet JSON")?;
    match tokens {
        Some(t) => {
            obj.insert("autoCompactWindow".into(), t.clamp(100_000, 1_000_000).into());
        }
        None => {
            obj.remove("autoCompactWindow");
        }
    }
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    write_user_file(path, &(text + "\n"))
}

#[tauri::command]
pub fn set_concise(enabled: bool) -> Result<(), String> {
    set_concise_at(&claude_md().ok_or("dossier utilisateur introuvable")?, enabled)
}

fn set_concise_at(path: &Path, enabled: bool) -> Result<(), String> {
    let text = read_user_file(path, "~/.claude/CLAUDE.md")?.unwrap_or_default();
    let without = match (text.find(CONCISE_START), text.find(CONCISE_END)) {
        (Some(start), Some(end)) if end > start => {
            format!("{}{}", &text[..start], &text[end + CONCISE_END.len()..]).trim().to_string()
        }
        _ => text.trim().to_string(),
    };
    let next = match (enabled, without.is_empty()) {
        (true, true) => CONCISE_BLOCK.to_string(),
        (true, false) => format!("{without}\n\n{CONCISE_BLOCK}"),
        (false, _) => without,
    };
    if next.is_empty() && !enabled {
        // We created the file: leave nothing behind.
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    write_user_file(path, &(next + "\n"))
}

fn claude_command() -> std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "claude"]).creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd
    }
    #[cfg(not(windows))]
    std::process::Command::new("claude")
}

fn which_claude() -> bool {
    claude_command()
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Rewrites a prompt for an AI, in as few tokens as possible, with Claude Haiku
/// (`claude -p`, on the user's own Claude Code account).
#[tauri::command]
pub async fn compress_with_claude(text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = std::env::temp_dir().join(COMPRESS_DIR);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let prompt = format!(
            "Compresse ce prompt destiné à un agent de code IA pour qu'il coûte le moins de tokens possible. \
             Style télégraphique, en anglais si c'est plus court, sans politesse ni remplissage, même si ça devient \
             peu lisible pour un humain. Garde tous les détails techniques : noms de fichiers, code, chiffres, \
             contraintes, intention. Réponds UNIQUEMENT avec le prompt compressé.\n\n<prompt>\n{text}\n</prompt>"
        );
        let mut child = claude_command()
            .args(["-p", "--model", "haiku"])
            .current_dir(&dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("impossible de lancer claude : {e}"))?;
        child.stdin.take().ok_or("stdin")?.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().chars().take(200).collect());
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn write_clipboard(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

/// The ghost menu's « Reprompt » reads the clipboard like Ctrl+Alt+P does.
#[tauri::command]
pub fn read_clipboard_text(app: AppHandle) -> String {
    read_clipboard(&app).unwrap_or_default()
}

pub fn read_clipboard(app: &AppHandle) -> Option<String> {
    app.clipboard().read_text().ok().filter(|t| !t.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::tests::{TempDir, ANSI};

    #[test]
    fn leaves_an_unreadable_claude_md_alone() {
        let dir = TempDir::new("concise-unreadable");
        let path = dir.0.join("CLAUDE.md");
        std::fs::write(&path, ANSI).unwrap();
        assert!(set_concise_at(&path, true).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), ANSI);
        assert!(set_concise_at(&path, false).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), ANSI);
    }

    #[test]
    fn adds_and_removes_only_its_block() {
        let dir = TempDir::new("concise");
        let path = dir.0.join("CLAUDE.md");
        std::fs::write(&path, "# Mes règles\n- Réponds en français.\n").unwrap();
        set_concise_at(&path, true).unwrap();
        let on = std::fs::read_to_string(&path).unwrap();
        assert!(on.starts_with("# Mes règles\n- Réponds en français.") && on.contains(CONCISE_START));
        set_concise_at(&path, false).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Mes règles\n- Réponds en français.\n");
    }

    #[test]
    fn compact_window_leaves_an_unreadable_settings_file_alone() {
        let dir = TempDir::new("compact-unreadable");
        let path = dir.0.join("settings.json");
        std::fs::write(&path, ANSI).unwrap();
        assert!(set_compact_window_at(&path, Some(200_000)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), ANSI);
    }

    #[test]
    fn compact_window_keeps_the_other_settings() {
        let dir = TempDir::new("compact");
        let path = dir.0.join("settings.json");
        std::fs::write(&path, r#"{"model": "opus", "env": {"A": "1"}}"#).unwrap();
        set_compact_window_at(&path, Some(200_000)).unwrap();
        let set = read_settings_at(&path).unwrap();
        assert_eq!((set["model"].as_str(), set["env"]["A"].as_str()), (Some("opus"), Some("1")));
        assert_eq!(set["autoCompactWindow"], 200_000);
        set_compact_window_at(&path, None).unwrap();
        assert!(read_settings_at(&path).unwrap().get("autoCompactWindow").is_none());
        assert!(!dir.0.join("settings.json.booffer-tmp").exists());
    }

    #[test]
    fn creates_then_removes_its_own_claude_md() {
        let dir = TempDir::new("concise-missing");
        let path = dir.0.join("CLAUDE.md");
        set_concise_at(&path, true).unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains(CONCISE_START));
        set_concise_at(&path, false).unwrap();
        assert!(!path.exists());
    }
}

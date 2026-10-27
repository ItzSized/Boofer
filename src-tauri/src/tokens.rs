//! « Économiser des tokens » (settings → ✂️ Tokens):
//! - compact earlier: Claude Code's `autoCompactWindow` setting caps the context it keeps
//!   (it re-reads the whole context at every message, so a smaller one costs less);
//! - concise answers: a marked block in ~/.claude/CLAUDE.md;
//! - prompt compression with Claude Haiku (the local, free one is in src/core/compress.js).

use std::io::Write;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::settings::claude_settings_path;

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
    let path = claude_settings_path().ok_or("dossier utilisateur introuvable")?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("~/.claude/settings.json illisible : {e}")),
        Err(_) => Ok(serde_json::json!({})),
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
    let path = claude_settings_path().ok_or("dossier utilisateur introuvable")?;
    let mut root = read_settings()?;
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
    std::fs::write(path, text + "\n").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_concise(enabled: bool) -> Result<(), String> {
    let path = claude_md().ok_or("dossier utilisateur introuvable")?;
    let text = std::fs::read_to_string(&path).unwrap_or_default();
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
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    std::fs::write(path, next + "\n").map_err(|e| e.to_string())
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

pub fn read_clipboard(app: &AppHandle) -> Option<String> {
    app.clipboard().read_text().ok().filter(|t| !t.trim().is_empty())
}

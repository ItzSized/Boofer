//! Claude Code's PermissionRequest hook POSTs to /permission and waits.
//! The request stays open until the user clicks Allow / Deny in Booffer,
//! or it times out and Claude Code falls back to its own prompt.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Must stay below the hook's own timeout (see hooks/claude-code-settings.example.json).
const TIMEOUT: Duration = Duration::from_secs(55);

#[derive(Default)]
pub struct Permissions {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, (Instant, tiny_http::Request)>>,
}

#[derive(Clone, serde::Serialize)]
struct PermissionEvent {
    id: u64,
    payload: serde_json::Value,
}

/// Keeps the request open and asks the frontend.
pub fn ask(app: &AppHandle, request: tiny_http::Request, payload: serde_json::Value) {
    let permissions = app.state::<Permissions>();
    let id = permissions.next_id.fetch_add(1, Relaxed);
    permissions.pending.lock().unwrap().insert(id, (Instant::now(), request));
    let _ = app.emit("permission-request", PermissionEvent { id, payload });
}

/// `decision` is Claude Code's `decision` object, or None to let Claude Code ask itself.
pub fn resolve(app: &AppHandle, id: u64, decision: Option<serde_json::Value>) {
    let entry = app.state::<Permissions>().pending.lock().unwrap().remove(&id);
    if let Some((_, request)) = entry {
        respond(request, decision);
    }
}

pub fn start_reaper(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let expired: Vec<(u64, tiny_http::Request)> = {
            let permissions = app.state::<Permissions>();
            let mut pending = permissions.pending.lock().unwrap();
            let ids: Vec<u64> = pending
                .iter()
                .filter(|(_, (since, _))| since.elapsed() > TIMEOUT)
                .map(|(id, _)| *id)
                .collect();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id).map(|(_, request)| (id, request)))
                .collect()
        };
        for (id, request) in expired {
            respond(request, None);
            let _ = app.emit("permission-expired", id);
        }
    });
}

fn respond(request: tiny_http::Request, decision: Option<serde_json::Value>) {
    let _ = match decision {
        Some(decision) => {
            let body = serde_json::json!({
                "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision }
            });
            let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                .expect("static header");
            request.respond(tiny_http::Response::from_string(body.to_string()).with_header(header))
        }
        None => request.respond(tiny_http::Response::empty(204)),
    };
}

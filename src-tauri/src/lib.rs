mod antigravity;
mod autostart;
mod codex;
mod permission;
mod pet;
mod settings;
mod tokens;
mod usage;

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::Ordering::Relaxed;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

use pet::PetState;
use settings::SettingsState;

/// Local port that agents (Claude Code hooks, scripts, other CLIs) POST to.
/// Also acts as our single-instance lock across the OS.
const EVENT_PORT: u16 = 47823;
const MAX_BODY_BYTES: u64 = 1 << 20;

/// Forwarded as-is to the frontend: the JS adapter registered for `source`
/// is responsible for turning `payload` into a normalized state.
#[derive(Clone, serde::Serialize)]
pub(crate) struct RawAgentEvent {
    pub(crate) source: String,
    pub(crate) payload: serde_json::Value,
}

/// When this executable was built (its modification time, in seconds). Read once at
/// launch: the file may be replaced while we run, and then it would describe the new one.
fn build_stamp() -> u64 {
    static STAMP: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    *STAMP.get_or_init(|| {
        std::env::current_exe()
            .and_then(std::fs::metadata)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs())
    })
}

/// Ensures only one instance of Booffer can run at a time.
/// - If the same or a newer build is already running, sends `POST /show` to unhide it and exits `0`.
/// - If an older build is holding port 47823 (it answers `/show` with an older stamp, or
///   without one), replaces it: launching a fresh build always gets you the fresh build.
fn acquire_single_instance_server() -> Option<tiny_http::Server> {
    if let Ok(server) = tiny_http::Server::http(("127.0.0.1", EVENT_PORT)) {
        return Some(server);
    }

    let addr = SocketAddr::from(([127, 0, 0, 1], EVENT_PORT));
    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
        let _ = stream.write_all(b"POST /show HTTP/1.1\r\nHost: 127.0.0.1:47823\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let mut resp = Vec::new();
        let _ = stream.take(4096).read_to_end(&mut resp);
        let resp = String::from_utf8_lossy(&resp);
        let running = resp.split("build=").nth(1).and_then(|b| b.trim().parse::<u64>().ok()).unwrap_or(0);
        if resp.contains(" 200 ") && running >= build_stamp() {
            // Existing instance woke up and unhid itself; do not open a second one.
            std::process::exit(0);
        }
    }

    // Older instance: stop it so this updated build can take over.
    #[cfg(windows)]
    {
        let my_pid = std::process::id();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/FI", &format!("PID ne {my_pid}"), "/IM", "booffer.exe"])
            .output();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/FI", &format!("PID ne {my_pid}"), "/IM", "Booffer.exe"])
            .output();
        std::thread::sleep(Duration::from_millis(350));
    }

    match tiny_http::Server::http(("127.0.0.1", EVENT_PORT)) {
        Ok(server) => Some(server),
        Err(_) => std::process::exit(0),
    }
}

/// `POST http://127.0.0.1:47823/event/<source>` with a JSON body: fire-and-forget status.
/// `POST http://127.0.0.1:47823/permission`: Claude Code waits for the user's answer.
/// `POST http://127.0.0.1:47823/show`: wakes and unhides the running single instance.
fn start_event_server(app: AppHandle, server: tiny_http::Server) {
    std::thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let is_post = *request.method() == tiny_http::Method::Post;

            if is_post && request.url() == "/show" {
                app.state::<PetState>().hidden.store(false, Relaxed);
                if let Some(items) = app.try_state::<TrayItems>() {
                    let _ = items.hidden.set_checked(false);
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
                let _ = request.respond(tiny_http::Response::from_string(format!("build={}", build_stamp())));
                continue;
            }

            let source = request
                .url()
                .strip_prefix("/event/")
                .map(|rest| rest.split('?').next().unwrap_or("").to_string())
                .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));

            let mut body = String::new();
            let read_ok = request
                .as_reader()
                .take(MAX_BODY_BYTES)
                .read_to_string(&mut body)
                .is_ok();

            let payload = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);

            if is_post && read_ok && request.url() == "/permission" {
                // Hidden, approvals off or "ne pas déranger": don't make Claude Code wait for a card.
                let config = app.state::<SettingsState>();
                let approvals = {
                    let settings = config.current.lock().unwrap();
                    settings.approvals && !settings.dnd
                };
                if approvals && !app.state::<PetState>().hidden.load(Relaxed) {
                    permission::ask(&app, request, payload);
                    continue;
                }
                let _ = request.respond(tiny_http::Response::empty(204));
                continue;
            }

            let status = match source {
                Some(source) if is_post && read_ok => {
                    let _ = app.emit("agent-event", RawAgentEvent { source, payload });
                    204
                }
                _ => 400,
            };
            let _ = request.respond(tiny_http::Response::empty(status));
        }
    });
}

/// Tray menu items whose checkmark mirrors the pet state.
struct TrayItems {
    follow: CheckMenuItem<Wry>,
    dnd: CheckMenuItem<Wry>,
    hidden: CheckMenuItem<Wry>,
}

/// Keeps the tray checkmarks in line with the settings (they can change from any window).
pub(crate) fn sync_tray(app: &AppHandle, settings: &settings::Settings) {
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.follow.set_checked(settings.follows_windows());
        let _ = items.dnd.set_checked(settings.dnd);
    }
}

#[tauri::command]
fn set_follow(app: AppHandle, enabled: bool) -> Result<(), String> {
    settings::update(&app, |s| {
        s.follow = enabled;
        if s.display == "follow" {
            s.display = "everywhere".into(); // old builds: the mode becomes the switch
        }
    })
}

/// `page`: "models" opens the usage view, anything else the settings.
#[tauri::command]
async fn open_settings(app: AppHandle, page: Option<String>) -> Result<(), String> {
    show_settings(&app, page.as_deref().unwrap_or("settings"))
}

fn show_settings(app: &AppHandle, page: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("settings-page", page);
        return Ok(());
    }
    let url = format!("settings.html#{page}");
    tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App(url.into()))
        .title("Réglages · Booffer")
        .inner_size(500.0, 720.0)
        .min_inner_size(420.0, 480.0)
        .center()
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_hidden(app: AppHandle, hidden: bool) {
    app.state::<PetState>().hidden.store(hidden, Relaxed);
    let _ = app.state::<TrayItems>().hidden.set_checked(hidden);
}

/// Keeps the ghost visible while a permission card waits, even outside the target app.
#[tauri::command]
fn set_attention(app: AppHandle, active: bool) {
    app.state::<PetState>().attention.store(active, Relaxed);
}

/// Keeps the ghost visible while an AI session is actively thinking or running tools.
#[tauri::command]
fn set_working(app: AppHandle, active: bool) {
    app.state::<PetState>().working.store(active, Relaxed);
}

/// Windows notification for a finished task, unless the user is already looking
/// at their editor (the ghost told them) or asked not to be disturbed.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String, force: Option<bool>) {
    let (enabled, dnd) = {
        let settings = app.state::<SettingsState>();
        let s = settings.current.lock().unwrap();
        (s.notifications, s.dnd)
    };
    let editor_in_front = app.state::<PetState>().editor_in_front.load(Relaxed);
    if enabled && !dnd && (force.unwrap_or(false) || !editor_in_front) {
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

/// Brings the window of a session's project to the front (click on the bubble).
#[tauri::command]
fn focus_project(project: String) -> bool {
    !project.trim().is_empty() && pet::focus_window_titled(&project)
}

/// Opens a page of the project on GitHub in the browser (only those).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/ItzSized/Boofer") {
        return Err("lien non autorisé".into());
    }
    #[cfg(windows)]
    let result = std::process::Command::new("explorer").arg(&url).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}

/// Ctrl+Alt+B: show / hide the ghost. Ctrl+Alt+M: usage of the models.
/// Ctrl+Alt+P: compress the prompt in the clipboard (the ghost window does it, see main.js).
fn shortcuts() -> tauri::plugin::TauriPlugin<Wry> {
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyB);
    let models = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM);
    let compress = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP);
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if shortcut == &toggle {
                let hidden = app.state::<PetState>().hidden.load(Relaxed);
                set_hidden(app.clone(), !hidden);
            } else if shortcut == &models {
                let _ = show_settings(app, "models");
            } else if shortcut == &compress {
                if let Some(text) = tokens::read_clipboard(app) {
                    let _ = app.emit_to("main", "compress-clipboard", text);
                }
            }
        })
        .build()
}

fn register_shortcuts(app: &AppHandle) {
    for shortcut in [
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyB),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP),
    ] {
        // Another app may own it already: Booffer works without.
        let _ = app.global_shortcut().register(shortcut);
    }
}

#[tauri::command]
fn resolve_permission(app: AppHandle, id: u64, decision: Option<serde_json::Value>) {
    permission::resolve(&app, id, decision);
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let following = app.state::<SettingsState>().current.lock().unwrap().follows_windows();
    let follow = CheckMenuItem::with_id(app, "follow", "Suis-moi (de fenêtre en fenêtre)", true, following, None::<&str>)?;
    let dnd_on = app.state::<SettingsState>().current.lock().unwrap().dnd;
    let dnd = CheckMenuItem::with_id(app, "dnd", "Ne pas déranger", true, dnd_on, None::<&str>)?;
    let hidden = CheckMenuItem::with_id(app, "hidden", "Masquer", true, false, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Réglages…", true, None::<&str>)?;
    let models_item = MenuItem::with_id(app, "models", "Usage des modèles…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quitter Booffer", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_item, &models_item, &follow, &dnd, &hidden, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip("Booffer")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let state = app.state::<PetState>();
            match event.id.as_ref() {
                "settings" => {
                    let _ = show_settings(app, "settings");
                }
                "models" => {
                    let _ = show_settings(app, "models");
                }
                "follow" => {
                    let following = app.state::<SettingsState>().current.lock().unwrap().follows_windows();
                    let _ = set_follow(app.clone(), !following);
                }
                "dnd" => {
                    let _ = settings::update(app, |s| s.dnd = !s.dnd);
                }
                "hidden" => set_hidden(app.clone(), !state.hidden.load(Relaxed)),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    app.manage(TrayItems { follow, dnd, hidden });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let Some(event_server) = acquire_single_instance_server() else {
        return;
    };
    let server_cell = std::sync::Mutex::new(Some(event_server));

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(shortcuts())
        .manage(PetState::default())
        .manage(antigravity::AntigravityState::default())
        .manage(permission::Permissions::default())
        .manage(usage::UsageCache::default())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_settings,
            settings::claude_hooks_status,
            settings::install_claude_hooks,
            autostart::get_autostart,
            autostart::set_autostart,
            usage::model_usage,
            usage::claude_context,
            antigravity::sync_antigravity,
            open_settings,
            set_follow,
            set_hidden,
            set_attention,
            set_working,
            notify,
            focus_project,
            tokens::get_token_savers,
            tokens::set_compact_window,
            tokens::set_concise,
            tokens::compress_with_claude,
            tokens::write_clipboard,
            open_url,
            resolve_permission,
            quit
        ])
        .setup(move |app| {
            let loaded = settings::load(app.handle());
            let initial = loaded.current.lock().unwrap().clone();
            app.manage(loaded);
            settings::apply(app.handle(), &initial);
            build_tray(app.handle())?;
            if let Some(server) = server_cell.lock().unwrap().take() {
                start_event_server(app.handle().clone(), server);
            }
            antigravity::start_watcher(app.handle().clone());
            codex::start_watcher(app.handle().clone());
            register_shortcuts(app.handle());
            std::thread::spawn(settings::upgrade_claude_hooks);
            permission::start_reaper(app.handle().clone());
            if let Some(window) = app.get_webview_window("main") {
                pet::start(window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

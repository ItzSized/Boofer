mod autostart;
mod permission;
mod pet;
mod settings;

use std::io::Read;
use std::sync::atomic::Ordering::Relaxed;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use pet::PetState;
use settings::SettingsState;

/// Local port that agents (Claude Code hooks, scripts, other CLIs) POST to.
const EVENT_PORT: u16 = 47823;
const MAX_BODY_BYTES: u64 = 1 << 20;

/// Forwarded as-is to the frontend: the JS adapter registered for `source`
/// is responsible for turning `payload` into a normalized state.
#[derive(Clone, serde::Serialize)]
struct RawAgentEvent {
    source: String,
    payload: serde_json::Value,
}

/// `POST http://127.0.0.1:47823/event/<source>` with a JSON body: fire-and-forget status.
/// `POST http://127.0.0.1:47823/permission`: Claude Code waits for the user's answer.
fn start_event_server(app: AppHandle) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", EVENT_PORT)) {
            Ok(server) => server,
            Err(err) => {
                eprintln!("[booffer] event server failed to start: {err}");
                return;
            }
        };

        for mut request in server.incoming_requests() {
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

            let is_post = *request.method() == tiny_http::Method::Post;
            let payload = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);

            if is_post && read_ok && request.url() == "/permission" {
                // Hidden or approvals off: don't make Claude Code wait for a card nobody sees.
                let approvals = app.state::<SettingsState>().current.lock().unwrap().approvals;
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
    hidden: CheckMenuItem<Wry>,
}

#[tauri::command]
fn set_follow(app: AppHandle, enabled: bool) -> Result<(), String> {
    settings::update(&app, |s| s.follow = enabled)?;
    let _ = app.state::<TrayItems>().follow.set_checked(enabled);
    Ok(())
}

#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app)
}

fn show_settings(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(app, "settings", tauri::WebviewUrl::App("settings.html".into()))
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

#[tauri::command]
fn resolve_permission(app: AppHandle, id: u64, decision: Option<serde_json::Value>) {
    permission::resolve(&app, id, decision);
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let following = app.state::<PetState>().follow.load(Relaxed);
    let follow = CheckMenuItem::with_id(app, "follow", "Me suivre", true, following, None::<&str>)?;
    let hidden = CheckMenuItem::with_id(app, "hidden", "Masquer", true, false, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Réglages…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quitter Booffer", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_item, &follow, &hidden, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip("Booffer")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let state = app.state::<PetState>();
            match event.id.as_ref() {
                "settings" => {
                    let _ = show_settings(app);
                }
                "follow" => {
                    let _ = set_follow(app.clone(), !state.follow.load(Relaxed));
                }
                "hidden" => set_hidden(app.clone(), !state.hidden.load(Relaxed)),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    app.manage(TrayItems { follow, hidden });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PetState::default())
        .manage(permission::Permissions::default())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_settings,
            settings::claude_hooks_installed,
            settings::install_claude_hooks,
            autostart::get_autostart,
            autostart::set_autostart,
            open_settings,
            set_follow,
            set_hidden,
            set_attention,
            resolve_permission,
            quit
        ])
        .setup(|app| {
            let loaded = settings::load(app.handle());
            let initial = loaded.current.lock().unwrap().clone();
            app.manage(loaded);
            settings::apply(app.handle(), &initial);
            build_tray(app.handle())?;
            start_event_server(app.handle().clone());
            permission::start_reaper(app.handle().clone());
            if let Some(window) = app.get_webview_window("main") {
                pet::start(window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

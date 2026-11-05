//! The ghost's "body": lives on top of the target apps (one spot per window) or
//! anywhere on the desktop, can follow you from window to window or glide to the mouse, and tells the
//! frontend which window is in front.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::time::Duration;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewWindow};

use crate::settings::SettingsState;

const FRAME: Duration = Duration::from_millis(16);
/// Logical px. Starts gliding toward the cursor beyond FAR, stops once within NEAR.
const FAR: f64 = 320.0;
const NEAR: f64 = 170.0;
const EASE: f64 = 0.07;
/// Cursor this close to the ghost's center = the user wants to grab/pat it, so hold still.
const HOVER_RADIUS: f64 = 75.0;
/// Ghost body center, as a fraction of the window size.
const ANCHOR: (f64, f64) = (0.5, 0.52);
/// First visit of a target window: bottom-right corner, this far from the edges (logical px).
const DEFAULT_MARGIN: (f64, f64) = (24.0, 16.0);

pub struct PetState {
    /// Glide toward the mouse cursor (settings → glide).
    pub glide: AtomicBool,
    pub hidden: AtomicBool,
    /// A permission card is waiting: stay visible even outside the target app.
    pub attention: AtomicBool,
    /// The window in front is one of the editors: no need for a Windows notification.
    pub editor_in_front: AtomicBool,
    /// Tray "Bring the ghost back": forget where it sat, put it back in sight.
    pub recall: AtomicBool,
    /// The browser window in front shows ChatGPT, Gemini, Claude… (web.rs).
    pub web_ai: AtomicBool,
}

impl Default for PetState {
    fn default() -> Self {
        Self {
            glide: AtomicBool::new(false),
            hidden: AtomicBool::new(false),
            attention: AtomicBool::new(false),
            editor_in_front: AtomicBool::new(false),
            recall: AtomicBool::new(false),
            web_ai: AtomicBool::new(false),
        }
    }
}

/// Sent to the frontend ~30 times per second.
#[derive(Clone, PartialEq, serde::Serialize)]
struct Tick {
    /// Cursor position relative to the window, in CSS px.
    x: i32,
    y: i32,
    visible: bool,
    moving: bool,
    vx: i32,
    /// Title of the window in front (its project name picks the session to show).
    title: String,
}

/// Linux: the part of the window that catches the pointer, in CSS pixels. The rest lets it through.
/// tao's "ignore" leaves a 1x1 area: on a Wayland desktop, the pointer would never enter the window
/// above a native one, and X would never see it over the ghost or a card.
#[tauri::command]
pub fn set_click_region(window: WebviewWindow, rects: Vec<[i32; 4]>) {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        let ghost = window.clone();
        let _ = window.run_on_main_thread(move || {
            let Some(gdk_window) = ghost.gtk_window().ok().and_then(|w| w.window()) else { return };
            let region = gtk::cairo::Region::create();
            for [left, top, right, bottom] in rects {
                let _ = region.union_rectangle(&gtk::cairo::RectangleInt::new(left, top, right - left, bottom - top));
            }
            gdk_window.input_shape_combine_region(&region, 0, 0);
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (window, rects);
}

pub fn start(window: WebviewWindow) {
    // Linux: on every virtual desktop, and first shown in the corner of the screen rather than
    // wherever the window manager put it.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
        window.state::<PetState>().recall.store(true, Relaxed);
    }
    std::thread::spawn(move || {
        let mut foreground = ForegroundTracker::default();
        let mut moving = false;
        let mut last_tick: Option<Tick> = None;
        // Where the ghost's feet (bottom center of our window) sit in each target window, as an
        // offset from its bottom-right corner: the same spot whatever the ghost's size.
        let mut spots: HashMap<usize, (f64, f64)> = HashMap::new();
        // Our window's last size (physical px) and scale factor.
        let mut last_size: Option<(f64, f64, f64)> = None;
        let mut placed_on: Option<usize> = None;
        let mut title = String::new();
        let mut settings_version = u64::MAX;
        let mut everywhere = false;
        // "Me suit partout": sits on whatever window is in front, any app.
        let mut follow_windows = false;
        let mut targets: Vec<String> = Vec::new();

        for frame in 0u64.. {
            std::thread::sleep(FRAME);
            // WebView2 forgets the see-through background when its GPU process restarts (sleep,
            // driver update…): the whole window turns into a black rectangle. Said again every
            // 5 s, so it comes back on its own.
            #[cfg(not(target_os = "linux"))]
            if frame % 300 == 0 {
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            }
            let (Ok(pos), Ok(size), Ok(scale), Some((cx, cy))) = (
                window.outer_position(),
                window.outer_size(),
                window.scale_factor(),
                os::cursor_pos().or_else(|| window.cursor_position().ok().map(|p| (p.x, p.y))),
            ) else {
                continue;
            };
            let config = window.state::<SettingsState>();
            if config.version.load(Relaxed) != settings_version {
                settings_version = config.version.load(Relaxed);
                let current = config.current.lock().unwrap();
                let next: Vec<String> = current.target_apps.iter().map(|t| t.trim().to_lowercase()).collect();
                // Only where the ghost lives matters here. The other settings (size, sounds…) are
                // changed while a window of ours is in front: starting over would hide the ghost.
                if (current.everywhere(), current.follows_windows(), &next) != (everywhere, follow_windows, &targets) {
                    everywhere = current.everywhere();
                    follow_windows = current.follows_windows();
                    targets = next;
                    foreground.retarget(&targets, follow_windows);
                    placed_on = None;
                }
            }

            let state = window.state::<PetState>();
            foreground.poll(&targets, follow_windows, state.web_ai.load(Relaxed));
            state.editor_in_front.store(foreground.editor.is_some(), Relaxed);
            let target = if everywhere && !follow_windows { None } else { foreground.target() };
            // "Bring the ghost back": every window's spot is forgotten, so it lands back in the
            // default corner of the one it sits on (placed below, or further down on the desktop).
            let recall = state.recall.swap(false, Relaxed);
            if recall {
                spots.clear();
                placed_on = None;
            }
            let shown = everywhere
                || follow_windows
                || !os::supports_window_tracking()
                || target.is_some()
                || state.attention.load(Relaxed);
            let visible = shown && !state.hidden.load(Relaxed);

            // Title of the window in front: names the project, hence the session to show.
            let title_hwnd = if everywhere { foreground.other } else { target.map(|(h, _)| h) };
            if let Some(hwnd) = title_hwnd {
                if frame % 30 == 0 || placed_on != Some(hwnd) {
                    title = os::window_title(hwnd);
                }
            }

            let (x, y) = (pos.x as f64, pos.y as f64);
            let (w, h) = (size.width as f64, size.height as f64);
            let (dx, dy) = (cx - (x + w * ANCHOR.0), cy - (y + h * ANCHOR.1));
            let dist = dx.hypot(dy) / scale;

            let (mut nx, mut ny) = (x, y);
            let dragging = os::left_button_down();

            // The size setting changed: Windows kept our top-left corner, but the ghost stands at
            // the bottom center of the window, so it grows or shrinks around its feet instead.
            // (Same logical size on a monitor with another scale: nothing to do.)
            if let Some((lw, lh, ls)) = last_size.replace((w, h, scale)) {
                if (w / scale - lw / ls).abs() > 1.0 || (h / scale - lh / ls).abs() > 1.0 {
                    nx += ((lw - w) / 2.0).round();
                    ny += lh - h;
                }
            }

            // Switched to another target window: go back to the ghost's spot in that one.
            let mut arrived = false;
            if let Some((hwnd, r)) = target {
                if placed_on != Some(hwnd) {
                    let (ox, oy) = *spots
                        .entry(hwnd)
                        .or_insert((w / 2.0 + DEFAULT_MARGIN.0 * scale, DEFAULT_MARGIN.1 * scale));
                    nx = r.right - ox - w / 2.0;
                    ny = r.bottom - oy - h;
                    placed_on = Some(hwnd);
                    arrived = true;
                }
            }

            if visible && !dragging && !arrived {
                if state.glide.load(Relaxed) && dist > HOVER_RADIUS {
                    if dist > FAR {
                        moving = true;
                    } else if dist < NEAR {
                        moving = false;
                    }
                    if moving {
                        let k = (1.0 - NEAR / dist) * EASE;
                        nx += dx * k;
                        ny += dy * k;
                    }
                } else {
                    moving = false;
                }
            } else {
                moving = false;
            }
            // Recalled with no window to sit on (desktop, or nothing in front): bottom right of the
            // screen the cursor is on, i.e. the one whose tray was just clicked, above the taskbar.
            if recall && target.is_none() {
                // GTK looks for the monitor in logical pixels.
                #[cfg(target_os = "linux")]
                let (mx, my) = (cx / scale, cy / scale);
                #[cfg(not(target_os = "linux"))]
                let (mx, my) = (cx, cy);
                if let Ok(Some(monitor)) = window.monitor_from_point(mx, my) {
                    let (area, s) = (monitor.work_area(), monitor.scale_factor());
                    let (left, top) = (area.position.x as f64, area.position.y as f64);
                    // Our size once there: Windows keeps the logical size on a screen with another scale.
                    let (sw, sh) = (w / scale * s, h / scale * s);
                    nx = (left + area.size.width as f64 - sw - DEFAULT_MARGIN.0 * s).max(left);
                    ny = (top + area.size.height as f64 - sh - DEFAULT_MARGIN.1 * s).max(top);
                }
            }
            if let Some((hwnd, r)) = target {
                // Don't fight the OS while the user drags; snap back inside once released.
                if !dragging {
                    nx = nx.min(r.right - w).max(r.left);
                    ny = ny.min(r.bottom - h).max(r.top);
                }
                spots.insert(hwnd, (r.right - (nx + w / 2.0), r.bottom - (ny + h)));
            }

            let (step_x, step_y) = ((nx - x).round(), (ny - y).round());
            if step_x != 0.0 || step_y != 0.0 {
                let _ = window.set_position(PhysicalPosition::new((x + step_x) as i32, (y + step_y) as i32));
            } else {
                moving = false;
            }

            if frame % 2 == 0 {
                let tick = Tick {
                    x: ((cx - x - step_x) / scale) as i32,
                    y: ((cy - y - step_y) / scale) as i32,
                    visible,
                    moving,
                    vx: (step_x / scale) as i32,
                    title: title.clone(),
                };
                // Unchanged ticks too, once a second: the page may have missed the last one
                // (at startup it is not listening yet, and a still cursor sends nothing new).
                if last_tick.as_ref() != Some(&tick) || frame % 60 == 0 {
                    let _ = window.emit("pet-tick", &tick);
                    last_tick = Some(tick);
                }
            }
        }
    });
}

/// Remembers the last foreground window that isn't ours, and whether it is a target app.
/// Clicking the ghost makes *our* window foreground: that keeps the last answer.
#[derive(Default)]
struct ForegroundTracker {
    hwnd: usize,
    other: Option<usize>,
    /// Where the ghost sits: the editor in front, or (follow mode) any app window in front.
    target: Option<usize>,
    /// The editor in front, if it is one.
    editor: Option<usize>,
    /// An AI chat tab is in front in the browser (web.rs): the browser counts as an editor
    /// when "web-ai" is among the targets.
    web_ai: bool,
}

/// Browsers whose tabs web.rs can read (Chromium based).
const BROWSERS: &[&str] = &["chrome.exe", "msedge.exe", "brave.exe", "opera.exe", "vivaldi.exe", "arc.exe"];

impl ForegroundTracker {
    fn poll(&mut self, targets: &[String], any_window: bool, web_ai: bool) {
        let hwnd = os::foreground_window();
        // Switching tabs keeps the same browser window: web.rs's answer changes instead.
        if hwnd == self.hwnd && web_ai == self.web_ai {
            return;
        }
        self.web_ai = web_ai;
        self.hwnd = hwnd;
        if os::window_pid(hwnd) == std::process::id() {
            return;
        }
        self.classify(hwnd, targets, any_window);
    }

    /// New targets or mode: judges the last window that isn't ours again right away, since
    /// ours (the settings window, the menu) is usually the one in front when they change.
    fn retarget(&mut self, targets: &[String], any_window: bool) {
        self.hwnd = 0;
        self.editor = None;
        self.target = None;
        if let Some(hwnd) = self.other {
            self.classify(hwnd, targets, any_window);
        }
    }

    /// `hwnd` is the last window in front that isn't ours: is it one the ghost sits on?
    fn classify(&mut self, hwnd: usize, targets: &[String], any_window: bool) {
        let pid = os::window_pid(hwnd);
        self.other = Some(hwnd);
        let win_title = os::window_title(hwnd).to_lowercase();
        let is_target = os::process_name(pid).is_some_and(|path| {
            let path_lower = path.to_lowercase();
            targets
                .iter()
                .any(|t| !t.is_empty() && (path_lower.contains(t.as_str()) || win_title.contains(t.as_str())))
        }) || targets.iter().any(|t| !t.is_empty() && win_title.contains(t.as_str()))
            || (self.web_ai
                && targets.iter().any(|t| t == "web-ai")
                && os::process_name(pid).is_some_and(|path| {
                    let path = path.to_lowercase();
                    BROWSERS.iter().any(|b| path.ends_with(b))
                }));
        self.editor = is_target.then_some(hwnd);
        if is_target || (any_window && os::is_app_window(hwnd)) {
            self.target = Some(hwnd);
        } else if !any_window {
            self.target = None;
        }
        // Follow mode, desktop or taskbar in front: stay on the last window.
    }

    fn target(&self) -> Option<(usize, os::Rect)> {
        let hwnd = self.target.filter(|&h| !os::is_minimized(h))?;
        os::window_rect(hwnd).map(|r| (hwnd, r))
    }
}

/// Brings to the front the first app window whose title contains `needle`.
pub fn focus_window_titled(needle: &str) -> bool {
    os::focus_window_titled(&needle.to_lowercase())
}

#[cfg(windows)]
pub(crate) mod os {
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, POINT, RECT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::LPARAM;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    #[derive(Clone, Copy)]
    pub struct Rect {
        pub left: f64,
        pub top: f64,
        pub right: f64,
        pub bottom: f64,
    }

    pub fn cursor_pos() -> Option<(f64, f64)> {
        let mut p = POINT { x: 0, y: 0 };
        (unsafe { GetCursorPos(&mut p) } != 0).then(|| (p.x as f64, p.y as f64))
    }

    pub fn supports_window_tracking() -> bool {
        true
    }

    pub fn left_button_down() -> bool {
        (unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } as u16 & 0x8000) != 0
    }

    pub fn foreground_window() -> usize {
        unsafe { GetForegroundWindow() as usize }
    }

    pub fn window_pid(hwnd: usize) -> u32 {
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd as HWND, &mut pid) };
        pid
    }

    pub fn is_minimized(hwnd: usize) -> bool {
        unsafe { IsIconic(hwnd as HWND) != 0 }
    }

    pub fn window_rect(hwnd: usize) -> Option<Rect> {
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        (unsafe { GetWindowRect(hwnd as HWND, &mut r) } != 0).then(|| Rect {
            left: r.left as f64,
            top: r.top as f64,
            right: r.right as f64,
            bottom: r.bottom as f64,
        })
    }

    /// A real application window: visible, titled, not the desktop, taskbar or a start menu.
    pub fn is_app_window(hwnd: usize) -> bool {
        const SHELL: [&str; 7] = [
            "Progman",
            "WorkerW",
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
            "Windows.UI.Core.CoreWindow",
            "NotifyIconOverflowWindow",
            "XamlExplorerHostIslandWindow",
        ];
        let mut buf = [0u16; 128];
        let len = unsafe { GetClassNameW(hwnd as HWND, buf.as_mut_ptr(), buf.len() as i32) };
        let class = String::from_utf16_lossy(&buf[..len.max(0) as usize]);
        hwnd != 0
            && unsafe { IsWindowVisible(hwnd as HWND) } != 0
            && !SHELL.contains(&class.as_str())
            && !window_title(hwnd).is_empty()
            && window_rect(hwnd).is_some_and(|r| r.right - r.left > 300.0 && r.bottom - r.top > 200.0)
    }

    pub fn focus_window_titled(needle: &str) -> bool {
        struct Search<'a> {
            needle: &'a str,
            found: usize,
        }
        unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
            let search = unsafe { &mut *(data as *mut Search) };
            let h = hwnd as usize;
            if window_pid(h) != std::process::id()
                && is_app_window(h)
                && window_title(h).to_lowercase().contains(search.needle)
            {
                search.found = h;
                return 0; // stop
            }
            1
        }
        let mut search = Search { needle, found: 0 };
        unsafe { EnumWindows(Some(visit), &mut search as *mut Search as LPARAM) };
        search.found != 0 && bring_to_front(search.found)
    }

    /// A window found earlier (a browser window read by web.rs): only an app window that
    /// isn't ours, and still there.
    pub fn focus_window(hwnd: usize) -> bool {
        (unsafe { IsWindow(hwnd as HWND) } != 0)
            && window_pid(hwnd) != std::process::id()
            && is_app_window(hwnd)
            && bring_to_front(hwnd)
    }

    fn bring_to_front(hwnd: usize) -> bool {
        unsafe {
            if IsIconic(hwnd as HWND) != 0 {
                ShowWindow(hwnd as HWND, SW_RESTORE);
            }
            SetForegroundWindow(hwnd as HWND) != 0
        }
    }

    /// Visible top-level windows with a title, front to back.
    pub fn top_level_windows() -> Vec<usize> {
        unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let list = &mut *(lparam as *mut Vec<usize>);
            if IsWindowVisible(hwnd) != 0 && GetWindowTextLengthW(hwnd) > 0 {
                list.push(hwnd as usize);
            }
            1
        }
        let mut list: Vec<usize> = Vec::new();
        unsafe { EnumWindows(Some(collect), &mut list as *mut Vec<usize> as LPARAM) };
        list
    }

    pub fn window_title(hwnd: usize) -> String {
        let mut buf = [0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd as HWND, buf.as_mut_ptr(), buf.len() as i32) };
        String::from_utf16_lossy(&buf[..len.max(0) as usize])
    }

    pub fn process_name(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0;
            CloseHandle(process);
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
        }
    }
}

/// Linux: X11 only, XWayland included (main.rs asks GTK for it). Wayland itself has no way to
/// place a window, keep it above the others or read the cursor outside it. One connection, opened
/// once: no screen or an X error gives the empty answer, never a panic. X coordinates are physical
/// pixels, like Tauri's `outer_position` and the Win32 calls above, whatever `scale_factor` says.
#[cfg(target_os = "linux")]
pub(crate) mod os {
    use std::sync::OnceLock;
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        AtomEnum, ClientMessageEvent, ConnectionExt as _, EventMask, GetPropertyReply, KeyButMask, QueryPointerReply,
    };
    use x11rb::rust_connection::RustConnection;

    /// In 32-bit units: enough for a long window list or title.
    const PROPERTY_MAX: u32 = 4096;

    x11rb::atom_manager! {
        Atoms: AtomsCookie {
            _NET_ACTIVE_WINDOW,
            _NET_CLIENT_LIST,
            _NET_CLIENT_LIST_STACKING,
            _NET_FRAME_EXTENTS,
            _NET_SUPPORTED,
            _NET_WM_NAME,
            _NET_WM_PID,
            _NET_WM_STATE,
            _NET_WM_STATE_HIDDEN,
            _NET_WM_STATE_SKIP_TASKBAR,
            _NET_WM_WINDOW_TYPE,
            _NET_WM_WINDOW_TYPE_NORMAL,
        }
    }

    struct X {
        conn: RustConnection,
        root: u32,
        atoms: Atoms,
    }

    fn x11() -> Option<&'static X> {
        static X11: OnceLock<Option<X>> = OnceLock::new();
        X11.get_or_init(connect).as_ref()
    }

    fn connect() -> Option<X> {
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots.get(screen)?.root;
        let atoms = Atoms::new(&conn).ok()?.reply().ok()?;
        Some(X { conn, root, atoms })
    }

    /// The rest of the app keeps window ids in a usize; 0 (nothing in front) is not a window.
    fn id(hwnd: usize) -> Option<u32> {
        u32::try_from(hwnd).ok().filter(|&w| w != 0)
    }

    fn property(x: &X, window: u32, atom: u32) -> Option<GetPropertyReply> {
        x.conn.get_property(false, window, atom, AtomEnum::ANY, 0, PROPERTY_MAX).ok()?.reply().ok()
    }

    fn property32(x: &X, window: u32, atom: u32) -> Option<Vec<u32>> {
        let reply = property(x, window, atom)?;
        let values = reply.value32()?.collect();
        Some(values)
    }

    fn pointer() -> Option<QueryPointerReply> {
        let x = x11()?;
        x.conn.query_pointer(x.root).ok()?.reply().ok()
    }

    fn has_state(x: &X, window: u32, state: u32) -> bool {
        property32(x, window, x.atoms._NET_WM_STATE).is_some_and(|states| states.contains(&state))
    }

    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct Rect {
        pub left: f64,
        pub top: f64,
        pub right: f64,
        pub bottom: f64,
    }

    pub fn cursor_pos() -> Option<(f64, f64)> {
        pointer().map(|p| (p.root_x as f64, p.root_y as f64))
    }

    /// False too under a window manager that doesn't say which window is in front (no EWMH): the
    /// ghost would wait forever for a window to sit on, so it stays on the desktop instead.
    /// Same on a Wayland desktop when X doesn't know the window in front: it's a native one, like
    /// VS Code and the terminal on Ubuntu, or ours. The ghost stays where it is rather than hiding.
    pub fn supports_window_tracking() -> bool {
        let tracks = x11().is_some_and(|x| {
            property32(x, x.root, x.atoms._NET_SUPPORTED).is_some_and(|names| names.contains(&x.atoms._NET_ACTIVE_WINDOW))
        });
        tracks && !(std::env::var_os("WAYLAND_DISPLAY").is_some() && {
            let front = window_pid(foreground_window());
            front == 0 || front == std::process::id()
        })
    }

    pub fn left_button_down() -> bool {
        pointer().is_some_and(|p| p.mask.contains(KeyButMask::BUTTON1))
    }

    pub fn foreground_window() -> usize {
        x11().and_then(|x| property32(x, x.root, x.atoms._NET_ACTIVE_WINDOW)?.first().copied()).unwrap_or(0) as usize
    }

    pub fn window_pid(hwnd: usize) -> u32 {
        let (Some(x), Some(w)) = (x11(), id(hwnd)) else { return 0 };
        property32(x, w, x.atoms._NET_WM_PID).and_then(|pid| pid.first().copied()).unwrap_or(0)
    }

    pub fn is_minimized(hwnd: usize) -> bool {
        let (Some(x), Some(w)) = (x11(), id(hwnd)) else { return false };
        has_state(x, w, x.atoms._NET_WM_STATE_HIDDEN)
    }

    /// In screen coordinates, the window manager's frame included (as GetWindowRect does).
    pub fn window_rect(hwnd: usize) -> Option<Rect> {
        let (x, w) = (x11()?, id(hwnd)?);
        let size = x.conn.get_geometry(w).ok()?.reply().ok()?;
        let at = x.conn.translate_coordinates(w, x.root, 0, 0).ok()?.reply().ok()?;
        // Left, right, top, bottom. A window without a frame has none of these.
        let frame = property32(x, w, x.atoms._NET_FRAME_EXTENTS).filter(|e| e.len() == 4).unwrap_or(vec![0; 4]);
        Some(Rect {
            left: at.dst_x as f64 - frame[0] as f64,
            top: at.dst_y as f64 - frame[2] as f64,
            right: at.dst_x as f64 + size.width as f64 + frame[1] as f64,
            bottom: at.dst_y as f64 + size.height as f64 + frame[3] as f64,
        })
    }

    /// A real application window: normal type, in the taskbar, titled, big enough to sit on.
    pub fn is_app_window(hwnd: usize) -> bool {
        let (Some(x), Some(w)) = (x11(), id(hwnd)) else { return false };
        let normal = match property32(x, w, x.atoms._NET_WM_WINDOW_TYPE) {
            Some(types) if !types.is_empty() => types.contains(&x.atoms._NET_WM_WINDOW_TYPE_NORMAL),
            // No type at all (xterm, for one) means normal, unless it belongs to another window.
            _ => property32(x, w, AtomEnum::WM_TRANSIENT_FOR.into()).is_none(),
        };
        normal
            && !has_state(x, w, x.atoms._NET_WM_STATE_SKIP_TASKBAR)
            && !window_title(hwnd).is_empty()
            && window_rect(hwnd).is_some_and(|r| r.right - r.left > 300.0 && r.bottom - r.top > 200.0)
    }

    pub fn focus_window_titled(needle: &str) -> bool {
        top_level_windows()
            .into_iter()
            .find(|&w| {
                window_pid(w) != std::process::id()
                    && is_app_window(w)
                    && window_title(w).to_lowercase().contains(needle)
            })
            .is_some_and(activate)
    }

    /// A window found earlier: only an app window that isn't ours, and still there.
    pub fn focus_window(hwnd: usize) -> bool {
        window_pid(hwnd) != std::process::id() && is_app_window(hwnd) && activate(hwnd)
    }

    /// Asks the window manager, which also brings a minimized window back. Source 2 ("pager"): the
    /// user asked for it, so focus stealing prevention leaves it alone. The switch comes just after.
    fn activate(hwnd: usize) -> bool {
        let (Some(x), Some(w)) = (x11(), id(hwnd)) else { return false };
        let event = ClientMessageEvent::new(32, w, x.atoms._NET_ACTIVE_WINDOW, [2u32, 0, 0, 0, 0]);
        let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
        x.conn.send_event(false, x.root, mask, event).is_ok_and(|sent| sent.check().is_ok())
    }

    /// Windows with a title, front to back (the stacking list goes bottom to top).
    pub fn top_level_windows() -> Vec<usize> {
        let Some(x) = x11() else { return Vec::new() };
        let stacked = property32(x, x.root, x.atoms._NET_CLIENT_LIST_STACKING).map(|mut list| {
            list.reverse();
            list
        });
        stacked
            .or_else(|| property32(x, x.root, x.atoms._NET_CLIENT_LIST))
            .unwrap_or_default()
            .into_iter()
            .map(|w| w as usize)
            .filter(|&w| !window_title(w).is_empty())
            .collect()
    }

    pub fn window_title(hwnd: usize) -> String {
        let (Some(x), Some(w)) = (x11(), id(hwnd)) else { return String::new() };
        if let Some(name) = property(x, w, x.atoms._NET_WM_NAME).filter(|p| !p.value.is_empty()) {
            return String::from_utf8_lossy(&name.value).into_owned();
        }
        // The older property: Latin-1 when its type says STRING.
        property(x, w, AtomEnum::WM_NAME.into()).map_or_else(String::new, |name| {
            if name.type_ == u32::from(AtomEnum::STRING) {
                name.value.iter().map(|&byte| byte as char).collect()
            } else {
                String::from_utf8_lossy(&name.value).into_owned()
            }
        })
    }

    /// The executable's full path, as on Windows. A process of another user only shows `comm`:
    /// its name, cut at 15 characters by the kernel.
    pub fn process_name(pid: u32) -> Option<String> {
        if let Ok(path) = std::fs::read_link(format!("/proc/{pid}/exe")) {
            let path = path.to_string_lossy();
            // Replaced on disk while running (an editor's update).
            return Some(path.strip_suffix(" (deleted)").unwrap_or(&path).to_string());
        }
        std::fs::read_to_string(format!("/proc/{pid}/comm")).ok().map(|name| name.trim().to_string())
    }
}

/// macOS: cursor position comes from Tauri's `window.cursor_position()`; no window tracking.
#[cfg(not(any(windows, target_os = "linux")))]
pub(crate) mod os {
    #[derive(Clone, Copy)]
    pub struct Rect {
        pub left: f64,
        pub top: f64,
        pub right: f64,
        pub bottom: f64,
    }
    pub fn cursor_pos() -> Option<(f64, f64)> { None }
    pub fn supports_window_tracking() -> bool { false }
    pub fn left_button_down() -> bool { false }
    pub fn foreground_window() -> usize { 0 }
    pub fn window_pid(_: usize) -> u32 { 0 }
    pub fn is_minimized(_: usize) -> bool { false }
    pub fn window_rect(_: usize) -> Option<Rect> { None }
    pub fn process_name(_: u32) -> Option<String> { None }
    pub fn window_title(_: usize) -> String { String::new() }
    pub fn top_level_windows() -> Vec<usize> { Vec::new() }
    pub fn is_app_window(_: usize) -> bool { false }
    pub fn focus_window_titled(_: &str) -> bool { false }
    pub fn focus_window(_: usize) -> bool { false }
}

/// Need a real X screen, a window manager, xterm and xdotool. Each one in its own process:
///   env -u DISPLAY cargo test --lib x11_no_display -- --ignored
///   cargo test --lib x11_lost_server -- --ignored                  (starts its own Xvfb)
///   xvfb-run -s "-screen 0 1600x1000x24" bash -c 'openbox & sleep 1; cargo test --lib x11_tracking_end_to_end -- --ignored --nocapture'
#[cfg(all(test, target_os = "linux"))]
mod x11_tests {
    use super::os;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, PropMode};
    use x11rb::rust_connection::RustConnection;
    use x11rb::wrapper::ConnectionExt as _;

    /// Doesn't leave a window or a server behind when a check fails.
    struct Killed(Child);
    impl Drop for Killed {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
        let start = Instant::now();
        while !done() {
            assert!(start.elapsed() < Duration::from_secs(10), "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn xterm(title: &str, geometry: &str) -> (Killed, usize) {
        let child = Command::new("xterm")
            .args(["-T", title, "-fn", "fixed", "-geometry", geometry, "-e", "sleep", "300"])
            .spawn()
            .expect("xterm starts");
        let term = Killed(child);
        let mut found = 0;
        wait_for(title, || {
            found = os::top_level_windows().into_iter().find(|&w| os::window_title(w) == title).unwrap_or(0);
            found != 0
        });
        (term, found)
    }

    fn xdotool(args: &[&str]) -> String {
        let out = Command::new("xdotool").args(args).stderr(Stdio::inherit()).output().expect("xdotool starts");
        assert!(out.status.success(), "xdotool {args:?} failed");
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// Size of the window without its frame, as another program sees it.
    fn client_size(window: usize) -> (f64, f64) {
        let shell = xdotool(&["getwindowgeometry", "--shell", &window.to_string()]);
        let value = |key: &str| -> f64 {
            shell.lines().find_map(|l| l.strip_prefix(key)).and_then(|v| v.parse().ok()).expect(key)
        };
        (value("WIDTH="), value("HEIGHT="))
    }

    fn atom(conn: &RustConnection, name: &str) -> u32 {
        conn.intern_atom(false, name.as_bytes()).unwrap().reply().unwrap().atom
    }

    fn set32(conn: &RustConnection, window: usize, name: &str, kind: AtomEnum, values: &[u32]) {
        let property = atom(conn, name);
        conn.change_property32(PropMode::REPLACE, window as u32, property, kind, values).unwrap().check().unwrap();
    }

    fn set8(conn: &RustConnection, window: usize, property: u32, kind: u32, bytes: &[u8]) {
        conn.change_property8(PropMode::REPLACE, window as u32, property, kind, bytes).unwrap().check().unwrap();
    }

    fn remove(conn: &RustConnection, window: usize, property: u32) {
        conn.delete_property(window as u32, property).unwrap().check().unwrap();
    }

    fn assert_no_such_window(hwnd: usize) {
        assert_eq!(os::window_pid(hwnd), 0, "pid of {hwnd:#x}");
        assert_eq!(os::window_title(hwnd), "", "title of {hwnd:#x}");
        assert_eq!(os::window_rect(hwnd), None, "rect of {hwnd:#x}");
        assert!(!os::is_minimized(hwnd), "minimized {hwnd:#x}");
        assert!(!os::is_app_window(hwnd), "app window {hwnd:#x}");
        assert!(!os::focus_window(hwnd), "focus {hwnd:#x}");
    }

    fn assert_nothing_answers() {
        assert!(!os::supports_window_tracking());
        assert_eq!(os::cursor_pos(), None);
        assert!(!os::left_button_down());
        assert_eq!(os::foreground_window(), 0);
        assert_eq!(os::top_level_windows(), Vec::<usize>::new());
        assert!(!os::focus_window_titled("anything"));
        assert_no_such_window(0x40_0001);
    }

    #[test]
    #[ignore = "CI only: run alone, without DISPLAY"]
    fn x11_no_display() {
        std::env::remove_var("DISPLAY");
        assert_nothing_answers();
        assert_no_such_window(0);
    }

    #[test]
    #[ignore = "CI only: run alone, starts Xvfb :87"]
    fn x11_lost_server() {
        let server = Command::new("Xvfb").args([":87", "-noreset", "-screen", "0", "800x600x24"]).spawn();
        let mut server = Killed(server.expect("Xvfb starts"));
        std::env::set_var("DISPLAY", ":87");
        wait_for("Xvfb", || x11rb::connect(None).is_ok());
        let (conn, screen) = x11rb::connect(None).unwrap();
        let root = conn.setup().roots[screen].root as usize;

        // A screen without a window manager: nothing can be followed, the ghost stays on the desktop.
        assert!(!os::supports_window_tracking());
        assert!(os::cursor_pos().is_some());
        assert_eq!(os::foreground_window(), 0);

        let active = atom(&conn, "_NET_ACTIVE_WINDOW");
        set32(&conn, root, "_NET_SUPPORTED", AtomEnum::ATOM, &[active]);
        assert!(os::supports_window_tracking());

        server.0.kill().unwrap();
        server.0.wait().unwrap();
        assert_nothing_answers();
        assert_nothing_answers();
    }

    #[test]
    #[ignore = "CI only: needs a real X screen with a window manager, xterm and xdotool"]
    fn x11_tracking_end_to_end() {
        let (conn, _) = x11rb::connect(None).expect("an X screen");
        wait_for("the window manager", os::supports_window_tracking);

        let (term_a, a) = xterm("Boofer-Test-A", "80x24+100+150");
        wait_for("A in front", || os::foreground_window() == a);
        let (term_b, b) = xterm("Boofer-Test-B", "80x24+700+350");
        wait_for("B in front", || os::foreground_window() == b);
        assert_ne!(a, b);
        println!("windows: A {a:#x}, B {b:#x}");

        // Window in front: title, pid, executable.
        assert_eq!(os::window_title(os::foreground_window()), "Boofer-Test-B");
        assert_eq!(os::window_pid(b), term_b.0.id());
        assert_eq!(os::window_pid(a), term_a.0.id());
        assert_eq!(os::process_name(term_b.0.id()).as_deref(), Some("/usr/bin/xterm"));

        // Another user's process: its exe link can't be read, comm can.
        assert!(std::fs::read_link("/proc/1/exe").is_err(), "this check needs a non-root user");
        let comm = std::fs::read_to_string("/proc/1/comm").unwrap();
        assert_eq!(os::process_name(1).as_deref(), Some(comm.trim()));
        assert_eq!(os::process_name(0), None);
        assert_eq!(os::process_name(u32::MAX), None);

        // Rectangle: -geometry places the frame's corner, so the frame must be counted. Inside it,
        // xterm's 80x24 in the "fixed" font is 484x316; openbox's frame is 1, 1, 20, 5 (left, right,
        // top, bottom).
        assert_eq!(client_size(a), (484.0, 316.0));
        assert_eq!(os::window_rect(a), Some(os::Rect { left: 100.0, top: 150.0, right: 586.0, bottom: 491.0 }));
        assert_eq!(os::window_rect(b), Some(os::Rect { left: 700.0, top: 350.0, right: 1186.0, bottom: 691.0 }));

        // Focus by title (any case), then by id: the active window really changes.
        assert!(super::focus_window_titled("BOOFER-test-a"));
        wait_for("A in front after focus_window_titled", || os::foreground_window() == a);
        assert_eq!(os::top_level_windows().first(), Some(&a), "front to back");
        assert!(os::top_level_windows().contains(&b));
        assert!(!super::focus_window_titled("no such window"));
        assert!(os::focus_window(b));
        wait_for("B in front after focus_window", || os::foreground_window() == b);
        assert_eq!(os::top_level_windows().first(), Some(&b), "front to back");

        // Our own windows are never focused.
        set32(&conn, a, "_NET_WM_PID", AtomEnum::CARDINAL, &[std::process::id()]);
        assert_eq!(os::window_pid(a), std::process::id());
        assert!(!super::focus_window_titled("boofer-test-a"));
        assert!(!os::focus_window(a));
        set32(&conn, a, "_NET_WM_PID", AtomEnum::CARDINAL, &[term_a.0.id()]);

        // App window: no type (xterm) or normal; not a dialog, a transient or out of the taskbar.
        assert!(os::is_app_window(a));
        let dialog = atom(&conn, "_NET_WM_WINDOW_TYPE_DIALOG");
        let normal = atom(&conn, "_NET_WM_WINDOW_TYPE_NORMAL");
        set32(&conn, a, "_NET_WM_WINDOW_TYPE", AtomEnum::ATOM, &[dialog]);
        assert!(!os::is_app_window(a), "dialog");
        set32(&conn, a, "_NET_WM_WINDOW_TYPE", AtomEnum::ATOM, &[normal]);
        assert!(os::is_app_window(a), "normal");
        remove(&conn, a, atom(&conn, "_NET_WM_WINDOW_TYPE"));
        set32(&conn, a, "WM_TRANSIENT_FOR", AtomEnum::WINDOW, &[b as u32]);
        assert!(!os::is_app_window(a), "transient");
        remove(&conn, a, AtomEnum::WM_TRANSIENT_FOR.into());
        let state = atom(&conn, "_NET_WM_STATE");
        let saved = conn.get_property(false, a as u32, state, AtomEnum::ATOM, 0, 64).unwrap().reply().unwrap();
        let saved: Vec<u32> = saved.value32().map(|v| v.collect()).unwrap_or_default();
        let skip = atom(&conn, "_NET_WM_STATE_SKIP_TASKBAR");
        set32(&conn, a, "_NET_WM_STATE", AtomEnum::ATOM, &[saved.clone(), vec![skip]].concat());
        assert!(!os::is_app_window(a), "skip_taskbar");
        set32(&conn, a, "_NET_WM_STATE", AtomEnum::ATOM, &saved);
        assert!(os::is_app_window(a), "back to normal");
        assert!(!os::is_app_window(0));

        // Minimized, and brought back by focus_window.
        assert!(!os::is_minimized(b));
        xdotool(&["windowminimize", &b.to_string()]);
        wait_for("B minimized", || os::is_minimized(b));
        assert!(!os::is_minimized(a));
        assert!(os::focus_window(b));
        wait_for("B restored", || !os::is_minimized(b) && os::foreground_window() == b);

        // Cursor, and the left button only.
        xdotool(&["mousemove", "321", "234"]);
        wait_for("cursor at 321,234", || os::cursor_pos() == Some((321.0, 234.0)));
        xdotool(&["mousemove", "1500", "900"]);
        wait_for("cursor at 1500,900", || os::cursor_pos() == Some((1500.0, 900.0)));
        assert!(!os::left_button_down());
        xdotool(&["mousedown", "3"]);
        std::thread::sleep(Duration::from_millis(100));
        assert!(!os::left_button_down(), "the right button is not the left one");
        xdotool(&["mouseup", "3"]);
        xdotool(&["mousedown", "1"]);
        wait_for("left button down", os::left_button_down);
        xdotool(&["mouseup", "1"]);
        wait_for("left button up", || !os::left_button_down());

        // Titles: _NET_WM_NAME (UTF-8) first, WM_NAME when it is missing or empty, in Latin-1 if STRING.
        let (net_name, utf8) = (atom(&conn, "_NET_WM_NAME"), atom(&conn, "UTF8_STRING"));
        let (wm_name, string) = (u32::from(AtomEnum::WM_NAME), u32::from(AtomEnum::STRING));
        set8(&conn, a, net_name, utf8, "\u{e9}t\u{e9} UTF-8".as_bytes());
        set8(&conn, a, wm_name, string, b"caf\xe9 latin1");
        assert_eq!(os::window_title(a), "\u{e9}t\u{e9} UTF-8");
        set8(&conn, a, net_name, utf8, b"");
        assert_eq!(os::window_title(a), "caf\u{e9} latin1");
        remove(&conn, a, net_name);
        assert_eq!(os::window_title(a), "caf\u{e9} latin1");
        set8(&conn, a, wm_name, utf8, "\u{e9}t\u{e9} WM_NAME".as_bytes());
        assert_eq!(os::window_title(a), "\u{e9}t\u{e9} WM_NAME");

        // What one frame of the loop asks, on a target window.
        let start = Instant::now();
        const FRAMES: u32 = 600;
        for _ in 0..FRAMES {
            std::hint::black_box((
                os::cursor_pos(),
                os::left_button_down(),
                os::foreground_window(),
                os::supports_window_tracking(),
                os::is_minimized(b),
                os::window_rect(b),
            ));
        }
        let per_frame = start.elapsed() / FRAMES;
        println!("one frame of X calls: {per_frame:?}");
        assert!(per_frame < Duration::from_millis(4), "{per_frame:?} of a 16 ms frame");

        // A window that closes: empty answers and X errors only, the connection lives on.
        drop(term_a);
        wait_for("A gone", || os::window_rect(a).is_none());
        for _ in 0..500 {
            assert_no_such_window(a);
            assert_no_such_window(0x1fff_ffff);
            assert_no_such_window(usize::MAX);
        }
        assert!(!os::top_level_windows().contains(&a));
        assert!(!super::focus_window_titled("boofer-test-a"));
        assert!(os::supports_window_tracking());
        assert_eq!(os::cursor_pos(), Some((1500.0, 900.0)));
        assert_eq!(os::window_title(b), "Boofer-Test-B");
        drop(term_b);
    }
}

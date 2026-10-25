//! The ghost's "body": lives on top of the target app (one spot per window),
//! optionally follows the mouse, and tells the frontend which window is in front.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::time::Duration;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewWindow};

/// Substring of the executable name the ghost is allowed to live on (lowercase).
const TARGET_APP: &str = "antigravity";

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
    pub follow: AtomicBool,
    pub hidden: AtomicBool,
    /// A permission card is waiting: stay visible even outside the target app.
    pub attention: AtomicBool,
}

impl Default for PetState {
    fn default() -> Self {
        Self { follow: AtomicBool::new(false), hidden: AtomicBool::new(false), attention: AtomicBool::new(false) }
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
    /// Title of the target window in front (its project name picks the session to show).
    title: String,
}

pub fn start(window: WebviewWindow) {
    std::thread::spawn(move || {
        let mut foreground = ForegroundTracker::default();
        let mut moving = false;
        let mut last_tick: Option<Tick> = None;
        // Where the ghost sits in each target window, as an offset from its bottom-right corner.
        let mut spots: HashMap<usize, (f64, f64)> = HashMap::new();
        let mut placed_on: Option<usize> = None;
        let mut title = String::new();

        for frame in 0u64.. {
            std::thread::sleep(FRAME);
            let (Ok(pos), Ok(size), Ok(scale), Some((cx, cy))) = (
                window.outer_position(),
                window.outer_size(),
                window.scale_factor(),
                os::cursor_pos(),
            ) else {
                continue;
            };
            let state = window.state::<PetState>();
            let target = foreground.target();
            let visible = (target.is_some() || state.attention.load(Relaxed)) && !state.hidden.load(Relaxed);

            let (x, y) = (pos.x as f64, pos.y as f64);
            let (w, h) = (size.width as f64, size.height as f64);
            let (dx, dy) = (cx - (x + w * ANCHOR.0), cy - (y + h * ANCHOR.1));
            let dist = dx.hypot(dy) / scale;

            let (mut nx, mut ny) = (x, y);
            let dragging = os::left_button_down();

            // Switched to another target window: go back to the ghost's spot in that one.
            let mut arrived = false;
            if let Some((hwnd, r)) = target {
                if placed_on != Some(hwnd) {
                    let (ox, oy) = *spots
                        .entry(hwnd)
                        .or_insert((w + DEFAULT_MARGIN.0 * scale, h + DEFAULT_MARGIN.1 * scale));
                    nx = r.right - ox;
                    ny = r.bottom - oy;
                    placed_on = Some(hwnd);
                    arrived = true;
                    title = os::window_title(hwnd);
                } else if frame % 30 == 0 {
                    title = os::window_title(hwnd); // the title follows the open file/project
                }
            }

            if visible && !dragging && !arrived {
                if state.follow.load(Relaxed) && dist > HOVER_RADIUS {
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
            if let Some((hwnd, r)) = target {
                // Don't fight the OS while the user drags; snap back inside once released.
                if !dragging {
                    nx = nx.min(r.right - w).max(r.left);
                    ny = ny.min(r.bottom - h).max(r.top);
                }
                spots.insert(hwnd, (r.right - nx, r.bottom - ny));
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
                if last_tick.as_ref() != Some(&tick) {
                    let _ = window.emit("pet-tick", &tick);
                    last_tick = Some(tick);
                }
            }
        }
    });
}

/// Remembers whether the foreground window belongs to the target app.
/// Clicking the ghost makes *our* window foreground: that keeps the last answer.
#[derive(Default)]
struct ForegroundTracker {
    hwnd: usize,
    target: Option<usize>,
}

impl ForegroundTracker {
    fn target(&mut self) -> Option<(usize, os::Rect)> {
        let hwnd = os::foreground_window();
        if hwnd != self.hwnd {
            self.hwnd = hwnd;
            let pid = os::window_pid(hwnd);
            if pid != std::process::id() {
                let is_target = os::process_name(pid)
                    .is_some_and(|name| name.to_lowercase().contains(TARGET_APP));
                self.target = is_target.then_some(hwnd);
            }
        }
        let hwnd = self.target.filter(|&h| !os::is_minimized(h))?;
        os::window_rect(hwnd).map(|r| (hwnd, r))
    }
}

#[cfg(windows)]
mod os {
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, POINT, RECT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
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

/// Other platforms: no following yet, the frontend keeps the ghost visible.
#[cfg(not(windows))]
mod os {
    #[derive(Clone, Copy)]
    pub struct Rect {
        pub left: f64,
        pub top: f64,
        pub right: f64,
        pub bottom: f64,
    }
    pub fn cursor_pos() -> Option<(f64, f64)> { None }
    pub fn left_button_down() -> bool { false }
    pub fn foreground_window() -> usize { 0 }
    pub fn window_pid(_: usize) -> u32 { 0 }
    pub fn is_minimized(_: usize) -> bool { false }
    pub fn window_rect(_: usize) -> Option<Rect> { None }
    pub fn process_name(_: u32) -> Option<String> { None }
    pub fn window_title(_: usize) -> String { String::new() }
}

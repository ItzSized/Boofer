//! Long commands in a terminal (a download, `sfc /scannow`, `winget install`, `pip install`…):
//! every 2 s the text shown in each Windows Terminal or console window is read through Windows
//! UI Automation, like web.rs reads the browser. When the last lines show a percentage that goes
//! up, Boofer follows it as a task: the % on the ghost, the time left from the command's own pace,
//! and a beep when it reaches 100 %. Events go out as "agent-event", source "terminal"
//! (see src/agents/terminal.js).
//! A window run as administrator can't be read by a normal app: such a command is only followed
//! with `sudo` in inline mode (its output shows in a normal window), or with Boofer run as
//! administrator too.

use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::pet::os;
use crate::settings::SettingsState;
use crate::RawAgentEvent;

const TERMINALS: &[&str] = &[
    "windowsterminal.exe",
    "openconsole.exe",
    "conhost.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    "wsl.exe",
    "bash.exe",
];
const POLL: Duration = Duration::from_secs(2);
/// Only the bottom of the screen: a percentage higher up is an old line.
const LAST_LINES: usize = 4;
/// The pace is measured on this much of the recent progress.
const WINDOW: Duration = Duration::from_secs(5 * 60);
/// Values seen before it counts as a command at work (a % that changed twice).
const MIN_SAMPLES: usize = 3;
/// Stuck at the same % for this long: no longer followed.
const STALL: Duration = Duration::from_secs(10 * 60);
/// Percentages that aren't a command's progress (status lines of other tools).
const IGNORED: &[&str] = &["context", "token", "cpu", "memory", "battery", "usage"];

/// The last percentage on the line: "Verification 45% complete." → 45, " 62,5 %|████" → 62.5.
fn percent_in(line: &str) -> Option<f64> {
    let chars: Vec<char> = line.chars().collect();
    let mut found = None;
    for (i, c) in chars.iter().enumerate() {
        if *c != '%' {
            continue;
        }
        let mut start = i;
        if start > 0 && chars[start - 1] == ' ' {
            start -= 1;
        }
        let end = start;
        while start > 0 && (chars[start - 1].is_ascii_digit() || chars[start - 1] == '.' || chars[start - 1] == ',') {
            start -= 1;
        }
        let number: String = chars[start..end].iter().map(|c| if *c == ',' { '.' } else { *c }).collect();
        if let Ok(value) = number.trim_matches('.').parse::<f64>() {
            if (0.0..=100.0).contains(&value) {
                found = Some(value);
            }
        }
    }
    found
}

/// The bottom-most percentage of the screen, with its line.
fn last_percent(text: &str) -> Option<(f64, String)> {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines.iter().rev().take(LAST_LINES).find_map(|line| {
        let lower = line.to_lowercase();
        if IGNORED.iter().any(|w| lower.contains(w)) {
            return None;
        }
        percent_in(line).map(|p| (p, line.chars().take(80).collect()))
    })
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// What one terminal window shows.
struct Job {
    /// Recent distinct values, oldest first.
    samples: Vec<(Instant, f64)>,
    active: bool,
    started_ms: u64,
    last: f64,
    last_change: Instant,
    /// Polls in a row without a percentage while active.
    missing: u32,
}

impl Job {
    fn new(now: Instant) -> Self {
        Self { samples: Vec::new(), active: false, started_ms: 0, last: -1.0, last_change: now, missing: 0 }
    }

    /// Done with this command: the % left on screen won't start it again (it doesn't change).
    fn reset(&mut self) {
        self.samples.clear();
        self.active = false;
        self.missing = 0;
    }

    /// Time left at the pace of the last few minutes, if it goes up.
    fn eta_ms(&self, pct: f64) -> Option<u64> {
        let (first, last) = (self.samples.first()?, self.samples.last()?);
        let seconds = (last.0 - first.0).as_secs_f64();
        let gained = last.1 - first.1;
        (seconds > 0.0 && gained > 0.0).then(|| ((100.0 - pct) / (gained / seconds) * 1000.0) as u64)
    }
}

pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(reader) = uia::Reader::new() else { return };
        let mut jobs: HashMap<usize, Job> = HashMap::new();
        loop {
            std::thread::sleep(POLL);
            let enabled = app.state::<SettingsState>().current.lock().unwrap().watch_terminal;
            if !enabled {
                for (hwnd, job) in jobs.drain() {
                    if job.active {
                        emit(&app, hwnd, "closed", serde_json::json!({}));
                    }
                }
                continue;
            }
            let now = Instant::now();
            let mut seen = Vec::new();
            for hwnd in os::top_level_windows() {
                let is_terminal = os::process_name(os::window_pid(hwnd))
                    .is_some_and(|p| TERMINALS.iter().any(|t| p.to_lowercase().ends_with(t)));
                if !is_terminal {
                    continue;
                }
                let title = os::window_title(hwnd);
                // Claude Code and Codex show percentages of their own (context, limits).
                if title.starts_with('✳') || title.to_lowercase().contains("claude") || title.to_lowercase().contains("codex") {
                    continue;
                }
                seen.push(hwnd);
                let reading = reader.visible_text(hwnd).as_deref().and_then(last_percent);
                let job = jobs.entry(hwnd).or_insert_with(|| Job::new(now));
                let title: String = title.chars().take(50).collect();
                follow(&app, hwnd, job, reading, &title, now);
            }
            // Closed windows: their command can't be followed any more.
            jobs.retain(|hwnd, job| {
                let keep = seen.contains(hwnd);
                if !keep && job.active {
                    emit(&app, *hwnd, "closed", serde_json::json!({}));
                }
                keep
            });
        }
    });
}

fn follow(app: &AppHandle, hwnd: usize, job: &mut Job, reading: Option<(f64, String)>, title: &str, now: Instant) {
    let Some((pct, line)) = reading else {
        // The percentage is gone (the prompt came back): finished if it was nearly there.
        if job.active {
            job.missing += 1;
            if job.missing >= 2 {
                let kind = if job.last >= 90.0 { "done" } else { "closed" };
                emit(app, hwnd, kind, serde_json::json!({ "title": title }));
                job.reset();
            }
        } else {
            job.samples.clear();
        }
        return;
    };
    job.missing = 0;

    if pct != job.last {
        if pct < job.last {
            // Back down: another download, or the next step of the same command.
            if job.active && job.last >= 90.0 {
                emit(app, hwnd, "done", serde_json::json!({ "title": title }));
                job.reset();
            }
            job.samples.clear();
        }
        job.samples.push((now, pct));
        job.samples.retain(|(t, _)| now.duration_since(*t) <= WINDOW);
        job.last = pct;
        job.last_change = now;
    }

    let rising = job.samples.len() >= MIN_SAMPLES && job.samples.last().map(|s| s.1) > job.samples.first().map(|s| s.1);
    if !job.active && rising && pct < 100.0 {
        job.active = true;
        let since = job.samples.first().map(|s| now.duration_since(s.0).as_millis() as u64).unwrap_or(0);
        job.started_ms = now_ms().saturating_sub(since);
        emit(app, hwnd, "start", serde_json::json!({ "title": title, "line": line, "percent": pct / 100.0, "startedMs": job.started_ms }));
    }
    if !job.active {
        return;
    }
    if pct >= 100.0 {
        emit(app, hwnd, "done", serde_json::json!({ "title": title, "line": line }));
        job.reset();
    } else if now.duration_since(job.last_change) > STALL {
        emit(app, hwnd, "closed", serde_json::json!({}));
        job.reset();
    } else {
        emit(
            app,
            hwnd,
            "progress",
            serde_json::json!({
                "title": title,
                "line": line,
                "percent": pct / 100.0,
                "etaMs": job.eta_ms(pct),
                "startedMs": job.started_ms,
            }),
        );
    }
}

fn emit(app: &AppHandle, hwnd: usize, kind: &str, extra: serde_json::Value) {
    let mut payload = serde_json::json!({ "id": format!("t{hwnd}"), "kind": kind });
    if let (Some(out), Some(more)) = (payload.as_object_mut(), extra.as_object()) {
        for (key, value) in more {
            out.insert(key.clone(), value.clone());
        }
    }
    let _ = app.emit("agent-event", RawAgentEvent { source: "terminal".into(), payload });
}

#[cfg(windows)]
mod uia {
    use windows::core::BSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationTextPattern, TreeScope_Descendants,
        UIA_ClassNamePropertyId, UIA_IsTextPatternAvailablePropertyId, UIA_TextPatternId,
    };

    pub struct Reader {
        automation: IUIAutomation,
        /// The text of a Windows Terminal tab.
        terminal: IUIAutomationCondition,
        /// Anything with text: the screen of a classic console window.
        any_text: IUIAutomationCondition,
    }

    impl Reader {
        pub fn new() -> Option<Self> {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
                let terminal = automation
                    .CreatePropertyCondition(UIA_ClassNamePropertyId, &VARIANT::from(BSTR::from("TermControl")))
                    .ok()?;
                let any_text = automation
                    .CreatePropertyCondition(UIA_IsTextPatternAvailablePropertyId, &VARIANT::from(true))
                    .ok()?;
                Some(Self { automation, terminal, any_text })
            }
        }

        /// The lines on screen in the window's terminal (the tab in front for Windows Terminal).
        pub fn visible_text(&self, hwnd: usize) -> Option<String> {
            unsafe {
                let window = self.automation.ElementFromHandle(HWND(hwnd as _)).ok()?;
                let element = window
                    .FindFirst(TreeScope_Descendants, &self.terminal)
                    .or_else(|_| window.FindFirst(TreeScope_Descendants, &self.any_text))
                    .ok()?;
                let pattern: IUIAutomationTextPattern = element.GetCurrentPatternAs(UIA_TextPatternId).ok()?;
                let ranges = pattern.GetVisibleRanges().ok()?;
                let mut text = String::new();
                for i in 0..ranges.Length().ok()? {
                    let range = ranges.GetElement(i).ok()?;
                    text.push_str(&range.GetText(-1).ok()?.to_string());
                    text.push('\n');
                }
                Some(text)
            }
        }
    }
}

#[cfg(not(windows))]
mod uia {
    pub struct Reader;
    impl Reader {
        pub fn new() -> Option<Self> {
            None
        }
        pub fn visible_text(&self, _: usize) -> Option<String> {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{last_percent, percent_in};

    #[test]
    fn reads_percentages() {
        assert_eq!(percent_in("Verification 45% complete."), Some(45.0));
        assert_eq!(percent_in("Downloading  62,5 %|████"), Some(62.5));
        assert_eq!(percent_in("  ██████████▒▒▒▒  12.3 MB / 40 MB  31%"), Some(31.0));
        assert_eq!(percent_in("100%"), Some(100.0));
        assert_eq!(percent_in("no number here %"), None);
        assert_eq!(percent_in("250%"), None);
        assert_eq!(last_percent("old 10%\nline\nVerification 45% complete.\n\n   \n").map(|r| r.0), Some(45.0));
        assert_eq!(last_percent("Context 45% used\n").map(|r| r.0), None);
        assert_eq!(last_percent("10%\na\nb\nc\nd\n").map(|r| r.0), None);
    }
}

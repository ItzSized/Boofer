//! ChatGPT, Gemini, Claude, Grok… in the browser, with nothing to install: every second, the
//! tab shown in each Chrome / Edge / Brave window is read through Windows UI Automation (the
//! accessibility API screen readers use). Its address says which AI it is; a « Stop » button
//! on the page means the AI is answering. Each answer becomes the same events as the agents'
//! ("agent-event", source "web-<site>", see src/agents/web.js), so the ghost shows it, beeps at
//! the end, and keeps it in the history.
//! Only the tab in front of each window can be read: a window left in the background keeps
//! being followed, a tab hidden behind another one in the same window doesn't.

use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::pet::{os, PetState};
use crate::RawAgentEvent;

/// Address (without "https://") → site id, as in src/agents/web.js.
const SITES: &[(&str, &[&str])] = &[
    ("chatgpt", &["chatgpt.com", "chat.openai.com"]),
    ("gemini", &["gemini.google.com"]),
    ("aistudio", &["aistudio.google.com"]),
    ("claude", &["claude.ai"]),
    ("grok", &["grok.com"]),
    ("perplexity", &["perplexity.ai", "www.perplexity.ai"]),
    ("deepseek", &["chat.deepseek.com"]),
    ("mistral", &["chat.mistral.ai"]),
    ("copilot", &["copilot.microsoft.com"]),
];

const BROWSERS: &[&str] = &["chrome.exe", "msedge.exe", "brave.exe", "opera.exe", "vivaldi.exe"];
const POLL: Duration = Duration::from_secs(1);
/// The « Stop » button flickers between steps (search, thinking…): gone this long = finished.
const SETTLE: Duration = Duration::from_millis(1800);
const PROGRESS_EVERY: Duration = Duration::from_secs(3);

fn site_for(address: &str) -> Option<&'static str> {
    let host = address.trim_start_matches("https://").trim_start_matches("http://").split(['/', '?', '#']).next()?;
    let host = host.to_lowercase();
    SITES.iter().find(|(_, hosts)| hosts.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")))).map(|(id, _)| *id)
}

/// "Recette de crêpes - Google Chrome" → "Recette de crêpes".
fn tab_title(window_title: &str) -> String {
    let title = window_title.rsplit_once(" - ").map_or(window_title, |(t, _)| t);
    title.chars().take(50).collect()
}

/// One browser window whose tab in front is an AI chat.
struct Tab {
    site: &'static str,
    answering: bool,
    started: Instant,
    last_busy: Instant,
    last_progress: Instant,
}

pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(page) = uia::Reader::new() else { return };
        let mut tabs: HashMap<usize, Tab> = HashMap::new();
        loop {
            std::thread::sleep(POLL);
            let now = Instant::now();
            let foreground = os::foreground_window();
            let mut ai_in_front = false;
            let mut seen = Vec::new();

            for hwnd in os::top_level_windows() {
                let is_browser = os::process_name(os::window_pid(hwnd))
                    .is_some_and(|p| BROWSERS.iter().any(|b| p.to_lowercase().ends_with(b)));
                if !is_browser {
                    continue;
                }
                let Some(site) = page.address(hwnd).as_deref().and_then(site_for) else { continue };
                seen.push(hwnd);
                ai_in_front |= hwnd == foreground;
                let busy = page.has_stop_button(hwnd);
                let title = tab_title(&os::window_title(hwnd));
                let send = |kind: &str| emit(&app, site, hwnd, kind, &title);

                let tab = tabs.entry(hwnd).or_insert(Tab { site, answering: false, started: now, last_busy: now, last_progress: now });
                if tab.site != site {
                    // Another AI in the same window: the previous one can't be followed any more.
                    emit(&app, tab.site, hwnd, "closed", "");
                    *tab = Tab { site, answering: false, started: now, last_busy: now, last_progress: now };
                }
                if busy {
                    tab.last_busy = now;
                    if !tab.answering {
                        tab.answering = true;
                        tab.started = now;
                        tab.last_progress = now;
                        send("start");
                    } else if now - tab.last_progress >= PROGRESS_EVERY {
                        tab.last_progress = now;
                        send("progress");
                    }
                } else if tab.answering && now - tab.last_busy >= SETTLE {
                    tab.answering = false;
                    let took = (tab.last_busy - tab.started).as_millis() as u64;
                    let _ = app.emit(
                        "agent-event",
                        RawAgentEvent {
                            source: format!("web-{site}"),
                            payload: serde_json::json!({ "id": format!("w{hwnd}"), "kind": "done", "title": title, "tookMs": took }),
                        },
                    );
                }
            }

            // Closed windows, or tabs that left the AI site: their session ends.
            tabs.retain(|hwnd, tab| {
                let keep = seen.contains(hwnd);
                if !keep {
                    emit(&app, tab.site, *hwnd, "closed", "");
                }
                keep
            });
            app.state::<PetState>().web_ai.store(ai_in_front, std::sync::atomic::Ordering::Relaxed);
        }
    });
}

fn emit(app: &AppHandle, site: &str, hwnd: usize, kind: &str, title: &str) {
    let _ = app.emit(
        "agent-event",
        RawAgentEvent { source: format!("web-{site}"), payload: serde_json::json!({ "id": format!("w{hwnd}"), "kind": kind, "title": title }) },
    );
}

#[cfg(windows)]
mod uia {
    use windows::core::BSTR;
    use windows::Win32::System::Variant::VARIANT;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationCondition, PropertyConditionFlags, PropertyConditionFlags_IgnoreCase,
        PropertyConditionFlags_MatchSubstring, TreeScope_Descendants, UIA_ButtonControlTypeId, UIA_ControlTypePropertyId,
        UIA_EditControlTypeId, UIA_NamePropertyId, UIA_ValueValuePropertyId,
    };

    /// Words in the name of the button that stops an answer (« Stop streaming », « Arrêter la réponse »…).
    const STOP_WORDS: &[&str] = &["stop", "arrêter", "interrompre"];

    pub struct Reader {
        automation: IUIAutomation,
        edit: IUIAutomationCondition,
        stop_button: IUIAutomationCondition,
    }

    impl Reader {
        pub fn new() -> Option<Self> {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
                let edit = automation
                    .CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_EditControlTypeId.0))
                    .ok()?;
                let button = automation
                    .CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_ButtonControlTypeId.0))
                    .ok()?;
                let flags = PropertyConditionFlags(PropertyConditionFlags_IgnoreCase.0 | PropertyConditionFlags_MatchSubstring.0);
                let mut words: Option<IUIAutomationCondition> = None;
                for word in STOP_WORDS {
                    let one = automation
                        .CreatePropertyConditionEx(UIA_NamePropertyId, &VARIANT::from(BSTR::from(*word)), flags)
                        .ok()?;
                    words = Some(match words {
                        Some(any) => automation.CreateOrCondition(&any, &one).ok()?,
                        None => one,
                    });
                }
                let stop_button = automation.CreateAndCondition(&button, &words?).ok()?;
                Some(Self { automation, edit, stop_button })
            }
        }

        /// The address bar of a browser window: the first text field of the window.
        pub fn address(&self, hwnd: usize) -> Option<String> {
            unsafe {
                let window = self.automation.ElementFromHandle(HWND(hwnd as _)).ok()?;
                let bar = window.FindFirst(TreeScope_Descendants, &self.edit).ok()?;
                let value = bar.GetCurrentPropertyValue(UIA_ValueValuePropertyId).ok()?;
                let text = BSTR::try_from(&value).ok()?.to_string();
                (!text.is_empty()).then_some(text)
            }
        }

        pub fn has_stop_button(&self, hwnd: usize) -> bool {
            unsafe {
                let Ok(window) = self.automation.ElementFromHandle(HWND(hwnd as _)) else { return false };
                window.FindFirst(TreeScope_Descendants, &self.stop_button).is_ok()
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
        pub fn address(&self, _: usize) -> Option<String> {
            None
        }
        pub fn has_stop_button(&self, _: usize) -> bool {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{site_for, tab_title};

    #[test]
    fn recognizes_the_ai_sites() {
        assert_eq!(site_for("chatgpt.com/c/123"), Some("chatgpt"));
        assert_eq!(site_for("https://gemini.google.com/app"), Some("gemini"));
        assert_eq!(site_for("claude.ai/new"), Some("claude"));
        assert_eq!(site_for("www.perplexity.ai/search?q=x"), Some("perplexity"));
        assert_eq!(site_for("youtube.com/watch?v=chatgpt.com"), None);
        assert_eq!(site_for("google.com/search?q=claude.ai"), None);
        assert_eq!(tab_title("Recette de crêpes - Google Chrome"), "Recette de crêpes");
    }
}

#[cfg(all(test, windows))]
mod live {
    use super::*;

    /// cargo test --lib web::live -- --ignored --nocapture : what Booffer reads in the open browsers.
    #[test]
    #[ignore]
    fn prints_browser_tabs() {
        let page = uia::Reader::new().expect("UI Automation");
        for hwnd in os::top_level_windows() {
            let Some(exe) = os::process_name(os::window_pid(hwnd)) else { continue };
            if !BROWSERS.iter().any(|b| exe.to_lowercase().ends_with(b)) {
                continue;
            }
            let start = Instant::now();
            let address = page.address(hwnd);
            let stop = page.has_stop_button(hwnd);
            println!("{:?} | site {:?} | stop {stop} | {:?}", address, address.as_deref().and_then(site_for), start.elapsed());
        }
    }
}

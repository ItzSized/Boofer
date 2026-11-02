// Passes what the AI chat tabs do to Booffer (http://127.0.0.1:47823), and tells it when
// the tab in front is an AI chat, so the ghost can sit on the browser like on an editor.
importScripts("sites.js");

const BOOFFER = "http://127.0.0.1:47823";
/** tab id → site id, to end the session in Booffer when the tab closes. */
const tabSites = new Map();

async function post(path, body) {
  try {
    const res = await fetch(BOOFFER + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false; // Booffer isn't running
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "event" || !sender.tab) return;
  tabSites.set(sender.tab.id, message.site);
  post(`/event/web-${message.site}`, { ...message.payload, id: String(sender.tab.id) }).then((delivered) => reply({ delivered }));
  return true; // answers later
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const site = tabSites.get(tabId);
  if (!site) return;
  tabSites.delete(tabId);
  post(`/event/web-${site}`, { kind: "closed", id: String(tabId) });
});

// The URL of a tab is only visible for the AI sites (host permissions): any other tab is "not AI".
async function reportFocus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let active = false;
    try {
      active = Boolean(tab?.url && boofferSiteFor(new URL(tab.url).hostname));
    } catch {
      // chrome:// pages and the like
    }
    post("/web-focus", { active });
  } catch {
    // no window
  }
}

chrome.tabs.onActivated.addListener(reportFocus);
chrome.tabs.onUpdated.addListener((_id, change) => (change.url || change.status === "complete") && reportFocus());
// Leaving the browser needs no message: Booffer sees another app in front.
chrome.windows.onFocusChanged.addListener((id) => id !== chrome.windows.WINDOW_ID_NONE && reportFocus());
chrome.runtime.onStartup.addListener(reportFocus);
chrome.runtime.onInstalled.addListener(reportFocus);

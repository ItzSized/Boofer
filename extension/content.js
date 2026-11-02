// Watches one AI chat tab: when the AI starts answering, writes, and finishes.
// Booffer gets each step through background.js; without Booffer, the tab beeps by itself.
(() => {
  const site = boofferSiteFor(location.hostname);
  if (!site) return;

  /** The « Stop » button must be gone this long before the answer counts as finished. */
  const SETTLE_MS = 1500;
  const PROGRESS_EVERY_MS = 2000;
  const STOP_WORDS = /\b(stop|arr[êe]ter|interrompre|stopper)\b/i;

  let answering = false;
  let startedAt = 0;
  let lastBusyAt = 0;
  let lastProgressAt = 0;
  let pendingPrompt = "";
  let prompt = "";
  let settleTimer = null;

  const visible = (el) => {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  function isAnswering() {
    for (const selector of site.stop) {
      const el = document.querySelector(selector);
      // `data-is-streaming` style markers are not drawn: present is enough.
      if (el && (visible(el) || el.hasAttribute("data-is-streaming"))) return true;
    }
    // Any site: a visible button labelled « Stop » near the message box.
    for (const button of document.querySelectorAll("button")) {
      const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""} ${button.dataset.testid ?? ""}`;
      if (STOP_WORDS.test(label) && !/dict|record|enregistr|voice|vocal|partage|share/i.test(label) && visible(button)) return true;
    }
    return false;
  }

  function lastAnswer() {
    if (!site.answer) return "";
    const all = document.querySelectorAll(site.answer);
    return all.length ? all[all.length - 1].innerText ?? "" : "";
  }

  function model() {
    const el = site.model && document.querySelector(site.model);
    return el ? el.innerText.trim().split("\n")[0].slice(0, 40) : "";
  }

  // The conversation's name: the tab title without the site's own name.
  function title() {
    return document.title.replace(new RegExp(`\\s*[-|·–]?\\s*${site.name}\\s*[-|·–]?\\s*`, "i"), " ").trim().slice(0, 50);
  }

  // What the user asked, read from the message box just before it is sent.
  function composerText(el) {
    const box = el?.closest?.("textarea, [contenteditable='true']") ?? document.querySelector("textarea, [contenteditable='true']");
    if (!box) return "";
    return (box.value ?? box.innerText ?? "").trim();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) pendingPrompt = composerText(e.target) || pendingPrompt;
  }, true);
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest?.("button")) pendingPrompt = composerText(document.activeElement) || pendingPrompt;
  }, true);

  function send(kind, extra = {}) {
    const payload = { kind, title: title(), model: model(), prompt, ...extra };
    try {
      chrome.runtime.sendMessage({ type: "event", site: site.id, payload }, (reply) => {
        void chrome.runtime.lastError; // extension reloaded: nothing to do
        if (kind === "done" && reply && !reply.delivered) beep();
      });
    } catch {
      if (kind === "done") beep(); // the extension was updated: this tab still beeps
    }
  }

  // Booffer isn't running: a little « ding » here instead (two notes, like Booffer's).
  function beep() {
    try {
      const ctx = new AudioContext();
      [880, 1318.5].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime + i * 0.12;
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.2, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.55);
      });
    } catch {
      // no sound allowed yet
    }
  }

  function check() {
    const now = Date.now();
    if (isAnswering()) {
      lastBusyAt = now;
      clearTimeout(settleTimer);
      settleTimer = null;
      if (!answering) {
        answering = true;
        startedAt = now;
        prompt = pendingPrompt.slice(0, 300);
        pendingPrompt = "";
        lastProgressAt = now;
        send("start");
      } else if (now - lastProgressAt >= PROGRESS_EVERY_MS) {
        lastProgressAt = now;
        send("progress", { chars: lastAnswer().length });
      }
    } else if (answering && !settleTimer) {
      // Not instantly: the button flickers between steps (search, thinking…).
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (isAnswering() || Date.now() - lastBusyAt < SETTLE_MS - 100) return check();
        answering = false;
        send("done", { chars: lastAnswer().length, promptChars: prompt.length, tookMs: lastBusyAt - startedAt });
      }, SETTLE_MS);
    }
  }

  // DOM changes drive it (they keep coming in background tabs, unlike slowed-down timers),
  // with a timer as a safety net.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      check();
    }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "data-is-streaming", "disabled"] });
  setInterval(check, 1000);
})();

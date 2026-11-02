import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { adapterBySource } from "./agents/index.js";
import { EventBus } from "./core/event-bus.js";
import { loadHistory, recordFinished, todayStats } from "./core/history.js";
import { gainXp, levelFor, loadXp } from "./core/level.js";
import { compact, describeModel, localDay, summarize } from "./core/models.js";
import { dailyBudgets, limitsFromPercent } from "./core/budget.js";
import { recordWebAnswer, withWebUsage } from "./core/web-usage.js";
import { approx, clockTime, duration, isNewer } from "./core/format.js";
import { estimateTokens, repromptForAI } from "./core/compress.js";
import { EtaEstimator } from "./core/eta.js";
import { State } from "./core/states.js";
import { setTheme } from "./core/theme.js";
import { Tracker } from "./core/tracker.js";
import { configureSound, playAttention, playDone, playError } from "./audio/chime.js";
import { createBubble } from "./ui/bubble.js";
import { createMascot } from "./ui/mascot.js";
import { createMenu } from "./ui/menu.js";
import { createGuardCard } from "./ui/guard-card.js";
import { createPermissionCard } from "./ui/permission-card.js";
import { createPet } from "./ui/pet.js";
import { createSpeech } from "./ui/speech.js";
import { createTabs } from "./ui/tabs.js";
import { createUsageBar } from "./ui/usage-bar.js";
import "./style.css";

const isTauri = "__TAURI_INTERNALS__" in window;

// When opened in a standard browser (http://localhost:5173), show the full Boodev website
// (pass ?pet=1 in the URL if you only want the raw 240x360 pet widget).
// Loaded on demand: the ghost window itself never ships the website.
if (!isTauri && !window.location.search.includes("pet=1")) {
  Promise.all([import("../website/index.html?raw"), import("../website/src/main.js")]).then(
    ([{ default: websiteHtml }, { initWebsite }]) => {
      const doc = new DOMParser().parseFromString(websiteHtml, "text/html");
      doc.body.querySelectorAll("script").forEach((s) => s.remove());
      document.title = doc.title;
      document.body.className = "bg-grid selection:bg-violet-500 selection:text-white";
      document.body.innerHTML = doc.body.innerHTML;
      initWebsite();
    },
  );
} else {

  const bus = new EventBus();
  const tracker = new Tracker(bus);
  const mascotEl = document.getElementById("mascot");
  const mascot = createMascot(mascotEl);
  const eta = new EtaEstimator(); // shared by the bubble and the « 🟢 En direct » page
  const bubble = createBubble(document.getElementById("bubble"), { eta });
  const usageBar = createUsageBar(document.getElementById("usage-bar"), {
    isTauri,
    invoke,
    limits: (rows) => limitsFromPercent(rows, settings.dailyLimitPct),
    onData: (usage) => onUsage(usage),
  });
  const app = document.getElementById("app");
  const speech = createSpeech(document.getElementById("speech"), { enabled: () => settings.speech !== false });

  const claudeCode = adapterBySource.get("claude-code");
  const card = createPermissionCard(document.getElementById("ask"), {
    agentName: claudeCode.name,
    color: claudeCode.color,
    // Negative ids are local test requests (menu → "Tester une demande").
    resolve: (id, decision) => id >= 0 && invoke("resolve_permission", { id, decision }),
    onChange: () => onCardsChange(),
  });

  // « Stop ! » before a dangerous command (src-tauri/src/guard.rs): arms crossed until the user picks.
  const guard = createGuardCard(document.getElementById("guard"), {
    agentName: claudeCode.name,
    resolve: (id, allow) => id >= 0 && invoke("resolve_guard", { id, allow }),
    onChange(open) {
      if (open && !mascotEl.classList.contains("stop")) speech.say("stop");
      mascotEl.classList.toggle("stop", open);
      onCardsChange();
    },
  });

  const asking = () => card.isOpen() || guard.isOpen();
  function onCardsChange() {
    app.classList.toggle("asking", asking());
    if (isTauri) invoke("set_attention", { active: asking() });
    render(); // switches the ghost to "attention", which plays the ping
  }

  let settingsLoaded = false;
  let pet = null; // eyes, pats and click-through (created last, see createPet below)
  const bubbleEl = document.getElementById("bubble");
  bubbleEl.addEventListener("click", () => {
    const selected = selectedSession();
    if (isTauri && selected?.project) invoke("focus_project", { project: selected.project });
  });

  // Which session the ghost shows, in order: one that just finished (for a few
  // seconds), the tab the user clicked, the one whose project is in the title of
  // the Antigravity window in front, then the most urgent one.
  let sessions = [];
  let current = null;
  let windowTitle = "";
  let pinnedKey = null;
  let spotlight = null; // { key, until }

  const tabs = createTabs(document.getElementById("tabs"), {
    onSelect(key) {
      pinnedKey = key;
      render();
    },
  });

  function sessionForWindow() {
    const title = windowTitle.toLowerCase();
    const activeMatch = sessions.find(
      (s) => s.state !== State.IDLE && s.project && title.includes(s.project.toLowerCase()),
    );
    if (activeMatch) return activeMatch;
    if (current && current.state !== State.IDLE) return current;
    return sessions.find((s) => s.project && title.includes(s.project.toLowerCase())) ?? null;
  }

  function selectedSession() {
    const byKey = (key) => sessions.find((s) => s.key === key);
    if (spotlight && Date.now() < spotlight.until && byKey(spotlight.key)) return byKey(spotlight.key);
    return byKey(pinnedKey) ?? sessionForWindow() ?? current;
  }

  let lastState = State.IDLE;
  bus.on("change", (event) => {
    ({ current, sessions } = event);
    render();
  });

  function render() {
    const selected = selectedSession();
    const state = asking() ? State.ATTENTION : (selected?.state ?? State.IDLE);
    mascot.setState(state, asking() ? claudeCode.color : selected?.color);
    const context = contexts.get(selected?.key) ?? null;
    bubble.render(selected, context);
    // Clicking the bubble brings that session's window to the front.
    bubbleEl.classList.toggle("clickable", Boolean(isTauri && selected?.project && state !== State.IDLE));
    const tired = Boolean(context?.tokens && context.tokens / context.window >= 0.8 && state !== State.COMPACTING);
    if (tired && !mascotEl.classList.contains("tired")) speech.say("tired");
    mascotEl.classList.toggle("tired", tired);
    usageBar.setActiveSession(selected);
    tabs.render(sessions, selected?.key);
    const status = trayStatus(selected, state);
    if (isTauri && status !== trayText) {
      trayText = status;
      invoke("set_tray_status", { text: status });
    }

    if (state !== lastState) {
      if (state === State.ATTENTION) {
        playAttention();
        speech.say("attention");
      }
      if (state === State.ERROR) {
        playError();
        speech.say("error");
      }
      if (lastState === State.COMPACTING && state !== State.DONE) speech.say("relieved");
    }
    lastState = state;
    pet?.refresh(); // cards, tabs or the bubble may have appeared or gone under the cursor
  }

  // The tray icon's tooltip says what the bubble says: readable when the ghost is hidden or elsewhere.
  let trayText = "Booffer";
  function trayStatus(selected, state) {
    const parts = [settings.dnd ? "Booffer 🌙" : "Booffer"];
    if (asking()) parts.push(guard.isOpen() ? "« Stop ! » : une commande attend ta réponse" : "Une demande attend ta réponse");
    else if (selected && state !== State.IDLE) {
      const pct = typeof selected.progress === "number" ? ` · ${Math.round(selected.progress * 100)} %` : "";
      const left = state === State.DONE ? null : eta.remaining(selected);
      const rest = left == null ? "" : left < 5000 ? " · presque fini" : ` · reste ${approx(left)}`;
      parts.push(`${selected.project || selected.agent} : ${selected.label}${pct}${rest}`);
    } else parts.push("rien en cours");
    const busy = sessions.filter((s) => s.state !== State.IDLE).length;
    if (busy > 1) parts.push(`${busy} sessions`);
    // Windows cuts tooltips at 127 UTF-16 units: shorten by whole characters (emoji included).
    const chars = [...parts.join(" · ")];
    if (chars.join("").length <= 120) return chars.join("");
    while (chars.join("").length > 119) chars.pop();
    return `${chars.join("")}…`;
  }

  // Keeps the ⏱ timer in the bubble ticking.
  setInterval(() => {
    if (selectedSession()?.details?.startedAt) render();
  }, 1000);

  bus.on("finished", (session) => {
    spotlight = { key: session.key, until: Date.now() + 8000 };
    setTimeout(render, 8100);
    mascot.celebrate();
    playDone();
    const compactOnly = session.details?.compactOnly;
    speech.say(compactOnly ? "relieved" : "done");
    if (isTauri) invoke("notify", { title: session.headline ?? `${session.project || session.agent} a fini !`, body: notifyBody(session) });
    if (compactOnly) return;
    if (session.details?.webUsage) {
      recordWebAnswer(session.details.webUsage);
      usageBar.refresh();
    }
    recordFinished(session);
    const levelUp = gainXp();
    showLevel();
    if (levelUp) setTimeout(() => speech.tell(`Niveau ${levelUp.level} ! ${levelUp.title} 🎉`), 2800);
  });

  function onWindowTitle(title) {
    windowTitle = title;
    pinnedKey = null; // switching windows = back to automatic selection
    render();
  }

  // After any of these, a pending permission for that session was answered elsewhere.
  const MOVED_ON = new Set(["PostToolUse", "PostToolUseFailure", "Stop", "UserPromptSubmit", "SessionEnd"]);

  // How full each Claude Code session's context is (read from its transcript by Rust).
  const contexts = new Map(); // tracker key → { tokens, window, model, compactMs }
  const contextAsked = new Map(); // tracker key → last request time
  const CONTEXT_EVERY_MS = 8000;
  const CONTEXT_NOW = new Set(["Stop", "PreCompact", "SessionStart", "UserPromptSubmit"]);

  function refreshContext(payload) {
    const key = `claude-code:${payload.session_id}`;
    if (payload.hook_event_name === "SessionEnd") return contexts.delete(key);
    if (!isTauri || !payload.transcript_path) return;
    const now = Date.now();
    if (!CONTEXT_NOW.has(payload.hook_event_name) && now - (contextAsked.get(key) ?? 0) < CONTEXT_EVERY_MS) return;
    contextAsked.set(key, now);
    invoke("claude_context", { transcriptPath: payload.transcript_path })
      .then((info) => {
        // Right after a compaction there is no reply yet: keep the median duration only.
        if (info) contexts.set(key, info);
        else if (contexts.has(key)) contexts.set(key, { ...contexts.get(key), tokens: 0 });
        render();
      })
      .catch(() => {});
  }

  let usageRefreshTimer = null;
  /** Everything agents send goes through the Rust event server, then here. */
  function ingest(source, payload) {
    if (source === "claude-code" && MOVED_ON.has(payload?.hook_event_name)) card.dismissSession(payload.session_id);
    if (source === "claude-code" && payload?.session_id) refreshContext(payload);
    const adapter = adapterBySource.get(source);
    const update = adapter?.normalize(payload);
    if (update) {
      tracker.update(adapter, update);
      if (!usageRefreshTimer) {
        usageRefreshTimer = setTimeout(() => {
          usageRefreshTimer = null;
          usageBar.refresh();
        }, 1200);
      }
    }
  }

  /** Every session, for the « 🟢 En direct » page of the settings window. */
  function liveSnapshot() {
    const now = Date.now();
    return sessions.map((s) => {
      const d = s.details ?? {};
      const active = s.state !== State.IDLE && s.state !== State.DONE;
      return {
        key: s.key,
        agent: s.agent,
        color: s.color,
        project: s.project,
        state: s.state,
        label: s.label,
        model: d.model ? describeModel(d.model).name : null,
        prompt: d.prompt ?? null,
        elapsedMs: active && d.startedAt ? now - d.startedAt : 0,
        etaMs: active ? eta.remaining(s) : null,
        steps: d.steps ?? 0,
        files: d.files ?? 0,
        progress: s.progress,
        context: contexts.get(s.key) ?? null,
      };
    });
  }

  // Fake session to check animations and sounds without a real agent.
  async function runDemo(project = "démo", delay = 0, source = "generic", model = null) {
    const id = `demo-${project}-${Date.now()}`;
    const startedAt = Date.now();
    const details = (steps, files) => ({
      prompt: "Ajoute un mode sombre à l'app", startedAt, steps, files, ...(model ? { model } : {}),
      step: { index: Math.min(3, 1 + Math.floor(steps / 3)), count: 3, name: "Écrit les styles", progress: (steps % 3) / 3 + 0.15, startedAt },
    });
    const step = (state, extra = {}) => ingest(source, { id, project, state, ...(model ? { model } : {}), ...extra });
    await new Promise((r) => setTimeout(r, delay));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    step(State.THINKING, { details: details(0, 0), progress: 0.03 });
    await wait(1800);
    step(State.TOOL, { label: "Lit style.css", details: details(1, 0), progress: 0.1 });
    await wait(1500);
    for (let i = 2; i <= 9; i++) {
      step(State.TOOL, { label: `Modifie theme-${i}.css`, details: details(i, i - 1), progress: i / 10 });
      await wait(700);
    }
    step(State.DONE, { headline: `${project} a fini !`, label: "Terminé en 9 s", details: details(9, 8) });
  }

  // Fake Claude Code compaction: what the hooks send for a /compact.
  async function runCompactDemo() {
    const base = { session_id: `demo-compact-${Date.now()}`, cwd: "C:/Users/me/Booffer" };
    const key = `claude-code:${base.session_id}`;
    contexts.set(key, { tokens: 0, window: 1_000_000, model: "claude-opus-5-5", compactMs: 12_000 });
    ingest("claude-code", { ...base, hook_event_name: "PreCompact", trigger: "manual" });
    await new Promise((r) => setTimeout(r, 12_000));
    ingest("claude-code", { ...base, hook_event_name: "SessionStart", source: "compact" });
  }

  const TEST_REQUEST = () => ({
    id: -Date.now(),
    payload: {
      session_id: "test",
      cwd: "C:/Users/me/projet",
      tool_name: "Bash",
      tool_input: { command: "npm run build", description: "Compile le projet" },
      permission_suggestions: [{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm run build" }], behavior: "allow", destination: "localSettings" }],
    },
  });

  const TEST_GUARD = () => ({
    id: -Date.now(),
    danger: "supprimer définitivement des dossiers entiers (sans passer par la corbeille)",
    payload: { session_id: "test", cwd: "C:/Users/me/projet", tool_name: "Bash", tool_input: { command: "rm -rf src build", description: "Nettoie le projet" } },
  });

  const quit = () => (isTauri ? invoke("quit") : window.close());

  // Settings live in Rust (settings.json); every window gets "settings-changed".
  let settings = { follow: false, glide: false, sleepAfter: 45, size: 1, sounds: true, volume: 0.8, skin: "classique", accessory: "aucun", theme: "auto", dnd: false, dndUntil: 0, speech: true };

  function applySettings(next) {
    if (settingsLoaded && !settings.follow && next.follow) speech.say("follow");
    settingsLoaded = true;
    settings = next;
    configureSound({ sounds: settings.sounds && !settings.dnd, volume: settings.volume });
    const dndEl = document.getElementById("dnd");
    dndEl.classList.toggle("hidden", !settings.dnd);
    dndEl.title = settings.dnd && settings.dndUntil ? `Ne pas déranger jusqu'à ${clockTime(settings.dndUntil)}` : "Ne pas déranger";
    setTheme(settings.theme);
    document.documentElement.style.zoom = String(settings.size); // the window is resized to match
    mascotEl.dataset.skin = settings.skin;
    mascotEl.dataset.accessory = settings.accessory;
    usageBar.rerender();
    render(); // the tray tooltip shows « Ne pas déranger » too
  }

  // « Ne pas déranger » for a while ("30", "60", "morning"), with no end ("on"), or "off". The tray
  // and this menu end up here: only this window knows the local time for « demain matin ».
  function setDnd(choice) {
    const now = new Date();
    const morning = new Date(now);
    if (morning.getHours() >= 8) morning.setDate(morning.getDate() + 1);
    morning.setHours(8, 0, 0, 0);
    const until = { 30: now.getTime() + 30 * 60_000, 60: now.getTime() + 60 * 60_000, morning: morning.getTime() }[choice] ?? 0;
    invoke("set_settings", { settings: { ...settings, dnd: choice !== "off", dndUntil: until } });
  }

  // It ends by itself (checked every 15 s, so right after the PC wakes up too).
  setInterval(() => {
    if (settings.dnd && settings.dndUntil && Date.now() >= settings.dndUntil) {
      setDnd("off");
      speech.tell("🔔 Fin du « Ne pas déranger » : sons et demandes réactivés", 5000);
    }
  }, 15_000);

  // ---------- Extras: notifications, levels, limits, day summary, updates ----------

  function notifyBody(session) {
    const d = session.details ?? {};
    const model = d.model ? ` · ${describeModel(d.model).name}` : "";
    return [session.label + model, d.prompt ? `« ${d.prompt} »` : ""].filter(Boolean).join("\n");
  }

  function showLevel() {
    const { level } = levelFor(loadXp());
    mascotEl.dataset.tier = level >= 8 ? "gold" : level >= 5 ? "halo" : level >= 3 ? "glow" : "";
  }
  showLevel();

  // Warn once when a plan limit is almost used up (per limit window).
  let latestUsage = { rows: [], limits: [] };
  function onUsage(usage) {
    latestUsage = usage;
    const now = Date.now();
    for (const limit of usage.limits ?? []) {
      if (!(limit.resetsAt > now) || limit.usedPercent < 80) continue;
      if (!once(`booffer.limit.${limit.tool}.${limit.windowMinutes}.${limit.resetsAt}`)) continue;
      const span = limit.windowMinutes >= 1440 ? "de la semaine" : `de ${Math.round(limit.windowMinutes / 60)} h`;
      const text = `${limit.tool} : ${Math.round(limit.usedPercent)} % de ta limite ${span}, recharge dans ${roughly(limit.resetsAt - now)}`;
      speech.tell(`⚠️ ${text}`, 8000);
      if (isTauri) invoke("notify", { title: "Limite bientôt atteinte", body: text, force: true });
    }
    // The user's own daily limits (settings → 📊 Modèles): at 80 % and when over, once a day each.
    const rows = withWebUsage(usage.rows);
    for (const b of dailyBudgets(rows, limitsFromPercent(rows, settings.dailyLimitPct))) {
      const step = b.pct >= 1 ? 100 : b.pct >= 0.8 ? 80 : 0;
      if (!step || !once(`booffer.budget.${b.family}.${step}.${localDay(0)}`)) continue;
      const text = step === 100
        ? `${b.name} : limite du jour dépassée (${compact(b.used)} / ${compact(b.limit)} tokens)`
        : `${b.name} : ${Math.round(b.pct * 100)} % de ta limite du jour${b.delta > 5 ? `, en avance de ${b.delta} %` : ""}`;
      speech.tell(`${step === 100 ? "⛔" : "⚠️"} ${text}`, 8000);
      if (isTauri) invoke("notify", { title: step === 100 ? "Limite du jour dépassée" : "Limite du jour bientôt atteinte", body: text, force: true });
    }
  }

  function roughly(ms) {
    const min = Math.round(ms / 60_000);
    if (min < 60) return `${Math.max(1, min)} min`;
    if (min < 48 * 60) return `${Math.round(min / 60)} h`;
    return `${Math.round(min / 1440)} j`;
  }

  function once(key) {
    try {
      if (localStorage.getItem(key)) return false;
      localStorage.setItem(key, "1");
    } catch {
      // without storage, say it every time rather than never
    }
    return true;
  }

  function daySummary() {
    const stats = todayStats(loadHistory());
    const top = summarize(withWebUsage(latestUsage.rows), localDay(0))[0];
    const parts = [
      `${stats.tasks} tâche${stats.tasks > 1 ? "s" : ""}`,
      stats.ms ? duration(stats.ms) : "",
      top ? `surtout ${top.name}` : "",
    ].filter(Boolean);
    speech.tell(`📅 Aujourd'hui : ${parts.join(" · ")}`, 7000);
  }

  // The day summary pops once, at the first calm moment after 18 h.
  setInterval(() => {
    const calm = !sessions.some((s) => s.state !== State.IDLE) && !asking();
    if (calm && new Date().getHours() >= 18 && todayStats(loadHistory()).tasks > 0 && once(`booffer.summary.${localDay(0)}`)) {
      daySummary();
    }
  }, 60_000);

  // A new release on GitHub? Checked once a day.
  async function checkUpdate() {
    if (!isTauri || !once(`booffer.update.${localDay(0)}`)) return;
    try {
      const [{ getVersion }, res] = await Promise.all([
        import("@tauri-apps/api/app"),
        fetch("https://api.github.com/repos/ItzSized/Boofer/releases/latest"),
      ]);
      if (!res.ok) return;
      const latest = String((await res.json()).tag_name ?? "").replace(/^v/, "");
      if (latest && isNewer(latest, await getVersion())) speech.tell(`✨ Booffer ${latest} est dispo ! Voir les réglages`, 8000);
    } catch {
      // offline: try again tomorrow
    }
  }
  setTimeout(checkUpdate, 20_000);

  // Reprompt: the clipboard's prompt, rewritten for the AI only (local, or Claude Haiku if chosen).
  async function reprompt(text) {
    if (!text?.trim()) return speech.tell("📋 Copie d'abord ton prompt, puis Ctrl+Alt+P", 4000);
    const before = estimateTokens(text);
    let result = null;
    if (settings.repromptAi) {
      speech.tell("🔁 Je reformule avec Haiku…", 15000);
      result = await invoke("compress_with_claude", { text }).catch(() => null);
    }
    result ||= repromptForAI(text);
    await invoke("write_clipboard", { text: result });
    const after = estimateTokens(result);
    const saved = Math.max(0, Math.round((1 - after / before) * 100));
    speech.tell(`🔁 Reprompt prêt : −${saved} % (${before} → ${after} tokens). Colle-le !`, 5000);
  }

  async function repromptClipboard() {
    reprompt(await invoke("read_clipboard_text").catch(() => ""));
  }

  // Booffer can't type in Claude Code: it copies /compact and brings its window up.
  async function compactNow() {
    const project = selectedSession()?.project;
    await invoke("write_clipboard", { text: "/compact" });
    const focused = project ? await invoke("focus_project", { project }) : false;
    speech.tell(focused ? "📋 /compact copié : colle-le (Ctrl+V) puis Entrée" : "📋 /compact copié : colle-le dans Claude Code", 6000);
  }

  const menu = createMenu(document.getElementById("menu"), [
    { label: "✨ Tester l'animation", action: () => runDemo("Booffer", 0, "antigravity", "Gemini 3.1 Pro") },
    { label: "👻 Tester 2 sessions", action: () => (runDemo("site-web", 0, "antigravity", "Gemini 3.1 Pro"), runDemo("api", 2500, "claude-api")) },
    { label: "🧹 Tester un compactage", action: () => runCompactDemo() },
    { label: "📅 Ma journée", action: () => daySummary() },
    ...(isTauri
      ? [
        { label: "🧹 Compacter maintenant", action: () => compactNow() },
        { label: "🔁 Reprompt (presse-papier)", action: () => repromptClipboard() },
        { label: "✂️ Économiser des tokens", action: () => invoke("open_settings", { page: "tokens" }) },
        { label: "🟢 Agents en direct", action: () => invoke("open_settings", { page: "live" }) },
      ]
      : []),
    { label: "🔐 Tester une demande", action: () => card.add(TEST_REQUEST()) },
    { label: "🛑 Tester le stop", action: () => guard.add(TEST_GUARD()) },
    ...(isTauri
      ? [
        { label: "⚙️ Réglages", action: () => invoke("open_settings") },
        { label: "📊 Usage des modèles", action: () => invoke("open_settings", { page: "models" }) },
        {
          label: () => (settings.follow ? "🐾 Reste ici" : "🐾 Suis-moi (de fenêtre en fenêtre)"),
          action: () => invoke("set_follow", { enabled: !settings.follow }),
        },
        { label: "🌙 Ne pas déranger 1 h", visible: () => !settings.dnd, action: () => setDnd("60") },
        { label: "🌙 Ne pas déranger jusqu'à demain matin", visible: () => !settings.dnd, action: () => setDnd("morning") },
        {
          label: () => `🔔 Réactiver sons et demandes${settings.dndUntil ? ` (prévu à ${clockTime(settings.dndUntil)})` : ""}`,
          visible: () => settings.dnd,
          action: () => setDnd("off"),
        },
        { label: "🙈 Me cacher (icône de la barre)", action: () => invoke("set_hidden", { hidden: true }) },
      ]
      : []),
    { label: "👋 Quitter", action: quit },
  ], { onToggle: () => pet?.refresh() });
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    menu.show();
  });

  pet = createPet({
    app,
    mascot,
    mascotEl,
    closeBtn: document.getElementById("close"),
    fx: document.getElementById("fx"),
    targets: () =>
      [menu.isOpen() && menu.el, card.isOpen() && card.el, guard.isOpen() && guard.el, tabs.isOpen() && tabs.el, usageBar.el, bubbleEl.classList.contains("clickable") && bubbleEl].filter(Boolean),
    isTauri,
    onClose: quit,
    onWindowTitle,
    sleepAfterMs: () => settings.sleepAfter * 1000,
    onMoment: (kind) => speech.say(kind),
  });

  if (isTauri) {
    listen("agent-event", ({ payload }) => ingest(payload.source, payload.payload)).then(() => {
      invoke("sync_antigravity");
    });
    listen("permission-request", ({ payload }) => card.add(payload));
    listen("permission-expired", ({ payload }) => card.expire(payload));
    listen("guard-request", ({ payload }) => guard.add(payload));
    listen("live-request", () => emit("live-sessions", liveSnapshot()));
    listen("guard-expired", ({ payload }) => guard.expire(payload));
    listen("settings-changed", ({ payload }) => applySettings(payload));
    listen("dnd-choice", ({ payload }) => setDnd(payload)); // tray → « Ne pas déranger »
    // Ctrl+Alt+P: the prompt in the clipboard comes back rewritten for the AI.
    listen("compress-clipboard", ({ payload }) => reprompt(payload));
    invoke("get_settings").then((loaded) => {
      applySettings(loaded);
      setTimeout(() => speech.say("hello"), 900);
    });
  }

  // Exposed for quick experiments in the devtools console: booffer.demo()
  window.booffer = { demo: runDemo, compactDemo: runCompactDemo, ingest };
}

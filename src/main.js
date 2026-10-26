import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { adapterBySource } from "./agents/index.js";
import { EventBus } from "./core/event-bus.js";
import { State } from "./core/states.js";
import { setTheme } from "./core/theme.js";
import { Tracker } from "./core/tracker.js";
import { configureSound, playAttention, playDone, playError } from "./audio/chime.js";
import { createBubble } from "./ui/bubble.js";
import { createMascot } from "./ui/mascot.js";
import { createMenu } from "./ui/menu.js";
import { createPermissionCard } from "./ui/permission-card.js";
import { createPet } from "./ui/pet.js";
import { createSpeech } from "./ui/speech.js";
import { createTabs } from "./ui/tabs.js";
import "./style.css";

const isTauri = "__TAURI_INTERNALS__" in window;

const bus = new EventBus();
const tracker = new Tracker(bus);
const mascotEl = document.getElementById("mascot");
const mascot = createMascot(mascotEl);
const bubble = createBubble(document.getElementById("bubble"));
const app = document.getElementById("app");
const speech = createSpeech(document.getElementById("speech"), { enabled: () => settings.speech !== false });

const claudeCode = adapterBySource.get("claude-code");
const card = createPermissionCard(document.getElementById("ask"), {
  agentName: claudeCode.name,
  color: claudeCode.color,
  // Negative ids are local test requests (menu → "Tester une demande").
  resolve: (id, decision) => id >= 0 && invoke("resolve_permission", { id, decision }),
  onChange(open) {
    app.classList.toggle("asking", open);
    if (isTauri) invoke("set_attention", { active: open });
    render(); // switches the ghost to "attention", which plays the ping
  },
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
  const state = card.isOpen() ? State.ATTENTION : (selected?.state ?? State.IDLE);
  mascot.setState(state, card.isOpen() ? claudeCode.color : selected?.color);
  bubble.render(selected);
  tabs.render(sessions, selected?.key);

  if (state !== lastState) {
    if (state === State.ATTENTION) {
      playAttention();
      speech.say("attention");
    }
    if (state === State.ERROR) {
      playError();
      speech.say("error");
    }
  }
  lastState = state;
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
  speech.say("done");
});

function onWindowTitle(title) {
  windowTitle = title;
  pinnedKey = null; // switching windows = back to automatic selection
  render();
}

// After any of these, a pending permission for that session was answered elsewhere.
const MOVED_ON = new Set(["PostToolUse", "PostToolUseFailure", "Stop", "UserPromptSubmit", "SessionEnd"]);

/** Everything agents send goes through the Rust event server, then here. */
function ingest(source, payload) {
  if (source === "claude-code" && MOVED_ON.has(payload?.hook_event_name)) card.dismissSession(payload.session_id);
  const adapter = adapterBySource.get(source);
  const update = adapter?.normalize(payload);
  if (update) tracker.update(adapter, update);
}

// Fake session to check animations and sounds without a real agent.
async function runDemo(project = "démo", delay = 0) {
  const id = `demo-${project}-${Date.now()}`;
  const startedAt = Date.now();
  const details = (steps, files) => ({
    prompt: "Ajoute un mode sombre à l'app", startedAt, steps, files,
    step: { index: Math.min(3, 1 + Math.floor(steps / 3)), count: 3, name: "Écrit les styles", progress: (steps % 3) / 3 + 0.15, startedAt },
  });
  const step = (state, extra = {}) => ingest("generic", { id, project, state, ...extra });
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

const quit = () => (isTauri ? invoke("quit") : window.close());

// Settings live in Rust (settings.json); every window gets "settings-changed".
let settings = { follow: false, sleepAfter: 45, size: 1, sounds: true, volume: 0.8, skin: "classique", accessory: "aucun", theme: "auto", dnd: false, speech: true };

function applySettings(next) {
  settings = next;
  configureSound({ sounds: settings.sounds && !settings.dnd, volume: settings.volume });
  document.getElementById("dnd").classList.toggle("hidden", !settings.dnd);
  setTheme(settings.theme);
  document.documentElement.style.zoom = String(settings.size); // the window is resized to match
  mascotEl.dataset.skin = settings.skin;
  mascotEl.dataset.accessory = settings.accessory;
}

const menu = createMenu(document.getElementById("menu"), [
  { label: "✨ Tester l'animation", action: () => runDemo() },
  { label: "👻 Tester 2 sessions", action: () => (runDemo("site-web"), runDemo("api", 2500)) },
  { label: "🔐 Tester une demande", action: () => card.add(TEST_REQUEST()) },
  ...(isTauri
    ? [
        { label: "⚙️ Réglages", action: () => invoke("open_settings") },
        {
          label: () => (settings.follow ? "🐾 Arrête de me suivre" : "🐾 Suis-moi !"),
          action: () => invoke("set_follow", { enabled: !settings.follow }),
        },
        {
          label: () => (settings.dnd ? "🔔 Réactiver sons et demandes" : "🌙 Ne pas déranger"),
          action: () => invoke("set_settings", { settings: { ...settings, dnd: !settings.dnd } }),
        },
        { label: "🙈 Me cacher (icône de la barre)", action: () => invoke("set_hidden", { hidden: true }) },
      ]
    : []),
  { label: "👋 Quitter", action: quit },
]);
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  menu.show();
});

createPet({
  app,
  mascot,
  mascotEl,
  closeBtn: document.getElementById("close"),
  fx: document.getElementById("fx"),
  targets: () => [menu.isOpen() && menu.el, card.isOpen() && card.el, tabs.isOpen() && tabs.el].filter(Boolean),
  isTauri,
  onClose: quit,
  onWindowTitle,
  sleepAfterMs: () => settings.sleepAfter * 1000,
  onMoment: (kind) => speech.say(kind),
});

if (isTauri) {
  listen("agent-event", ({ payload }) => ingest(payload.source, payload.payload));
  listen("permission-request", ({ payload }) => card.add(payload));
  listen("permission-expired", ({ payload }) => card.expire(payload));
  listen("settings-changed", ({ payload }) => applySettings(payload));
  invoke("get_settings").then((loaded) => {
    applySettings(loaded);
    setTimeout(() => speech.say("hello"), 900);
  });
}

// Exposed for quick experiments in the devtools console: booffer.demo()
window.booffer = { demo: runDemo, ingest };

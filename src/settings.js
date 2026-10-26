import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { configureSound, playDone } from "./audio/chime.js";
import { duration } from "./core/format.js";
import { clearHistory, loadHistory, todayStats } from "./core/history.js";
import { setTheme } from "./core/theme.js";
import { createMascot } from "./ui/mascot.js";
import "./style.css";
import "./settings.css";

const SKINS = [
  { id: "classique", name: "Classique" },
  { id: "fraise", name: "Fraise" },
  { id: "menthe", name: "Menthe" },
  { id: "ciel", name: "Ciel" },
  { id: "citrouille", name: "Citrouille" },
  { id: "gelee", name: "Gelée" },
  { id: "or", name: "Or" },
  { id: "nuit", name: "Nuit" },
];
const ACCESSORIES = [
  { id: "aucun", name: "Aucun" },
  { id: "noeud", name: "🎀 Nœud" },
  { id: "chapeau", name: "🎩 Chapeau" },
  { id: "couronne", name: "👑 Couronne" },
  { id: "casque", name: "🎧 Casque" },
  { id: "pousse", name: "🌱 Pousse" },
  { id: "lunettes", name: "👓 Lunettes" },
];
const EDITORS = [
  { id: "antigravity", name: "Antigravity" },
  { id: "code", name: "VS Code" },
  { id: "cursor", name: "Cursor" },
  { id: "windsurf", name: "Windsurf" },
];
const SLEEP_CHOICES = [
  [30, "30 s"],
  [45, "45 s"],
  [60, "1 min"],
  [120, "2 min"],
  [300, "5 min"],
  [0, "Jamais"],
];

// In a plain browser (npm run dev), fake the Rust side so the page can be designed.
const isTauri = "__TAURI_INTERNALS__" in window;
const DEV_SETTINGS = {
  display: "editor", targetApps: ["antigravity"], follow: false, sounds: true, volume: 0.8,
  size: 1, skin: "classique", accessory: "aucun", sleepAfter: 45, approvals: true, theme: "auto", dnd: false, speech: true,
};
const DEV_ANSWERS = { get_settings: () => ({ ...DEV_SETTINGS }), claude_hooks_installed: () => false, get_autostart: () => false };
const call = isTauri ? invoke : async (cmd) => DEV_ANSWERS[cmd]?.();

const $ = (id) => document.getElementById(id);
const hero = $("hero");
createMascot(hero);

let settings = null;

// Skin picker: one mini ghost per skin, wearing the chosen accessory.
const skinsBlock = $("skins-block");
skinsBlock.innerHTML = `
  <p class="mb-1.5 text-sm font-medium">Skin</p>
  <div id="skins" class="grid grid-cols-4 gap-2"></div>
  <p class="mt-3 mb-1.5 text-sm font-medium">Accessoire</p>
  <div id="accessories" class="flex flex-wrap gap-1.5"></div>`;
const skinButtons = SKINS.map((skin) => {
  const button = document.createElement("button");
  button.className = "skin-card flex flex-col items-center rounded-xl pt-2 pb-1 ring-1 ring-black/10 dark:ring-white/15";
  const preview = document.createElement("div");
  preview.className = "mascot mini";
  preview.dataset.state = "idle";
  preview.dataset.skin = skin.id;
  createMascot(preview);
  const label = Object.assign(document.createElement("span"), { className: "text-[11px] text-zinc-600 dark:text-zinc-300", textContent: skin.name });
  button.append(preview, label);
  button.addEventListener("click", () => save({ skin: skin.id }));
  return { skin, button, preview };
});
$("skins").replaceChildren(...skinButtons.map((s) => s.button));
const accessoryButtons = ACCESSORIES.map((accessory) => {
  const button = Object.assign(document.createElement("button"), { className: "chip", textContent: accessory.name });
  button.addEventListener("click", () => save({ accessory: accessory.id }));
  return { accessory, button };
});
$("accessories").replaceChildren(...accessoryButtons.map((a) => a.button));

async function save(change) {
  settings = { ...settings, ...change };
  render();
  await call("set_settings", { settings });
}

function render() {
  setTheme(settings.theme);
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.themeChoice === settings.theme);
  });
  hero.dataset.skin = settings.skin;
  hero.dataset.accessory = settings.accessory;
  for (const { skin, button, preview } of skinButtons) {
    button.classList.toggle("selected", skin.id === settings.skin);
    preview.dataset.accessory = settings.accessory;
  }
  for (const { accessory, button } of accessoryButtons) button.classList.toggle("on", accessory.id === settings.accessory);
  configureSound(settings);

  $("size").value = settings.size;
  $("size-label").textContent = `${Math.round(settings.size * 100)} %`;

  document.querySelectorAll(".display-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.display === settings.display);
  });
  $("editors-block").classList.toggle("opacity-40", settings.display === "everywhere");
  renderEditors();

  $("follow").checked = settings.follow;
  $("sleep").value = String(settings.sleepAfter);
  $("sounds").checked = settings.sounds;
  $("volume").value = settings.volume;
  $("volume").disabled = !settings.sounds;
  $("approvals").checked = settings.approvals;
  $("dnd-toggle").checked = settings.dnd;
  $("speech-toggle").checked = settings.speech;
}

function renderEditors() {
  const known = EDITORS.map((e) => e.id);
  const custom = settings.targetApps.filter((id) => !known.includes(id));
  const chips = [...EDITORS, ...custom.map((id) => ({ id, name: id, custom: true }))].map((editor) => {
    const on = settings.targetApps.includes(editor.id);
    const chip = document.createElement("button");
    chip.className = `chip ${on ? "on" : ""}`;
    chip.textContent = `${on ? "✓ " : ""}${editor.name}${editor.custom ? "  ×" : ""}`;
    chip.addEventListener("click", () => {
      const targetApps = on ? settings.targetApps.filter((id) => id !== editor.id) : [...settings.targetApps, editor.id];
      save({ targetApps });
    });
    return chip;
  });
  $("editors").replaceChildren(...chips);
}

function renderHistory() {
  const entries = loadHistory();
  const stats = todayStats(entries);
  $("stat-tasks").textContent = stats.tasks;
  $("stat-time").textContent = duration(stats.ms);
  $("stat-files").textContent = stats.files;

  const rows = entries.slice(0, 8).map((entry) => {
    const li = document.createElement("li");
    li.className = "flex items-center gap-2 py-1.5 text-xs";
    const dot = Object.assign(document.createElement("span"), { className: "size-2 shrink-0 rounded-full" });
    dot.style.background = entry.color;
    const text = document.createElement("div");
    text.className = "min-w-0 flex-1";
    const title = Object.assign(document.createElement("p"), {
      className: "truncate font-medium",
      textContent: entry.prompt ? `« ${entry.prompt} »` : entry.agent,
    });
    const meta = Object.assign(document.createElement("p"), {
      className: "truncate text-[11px] text-zinc-400",
      textContent: [entry.project, entry.ms ? duration(entry.ms) : "", entry.files ? `${entry.files} fichier${entry.files > 1 ? "s" : ""}` : ""]
        .filter(Boolean)
        .join(" · "),
    });
    text.append(title, meta);
    const time = Object.assign(document.createElement("span"), {
      className: "shrink-0 text-[11px] tabular-nums text-zinc-400",
      textContent: new Date(entry.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
    });
    li.append(dot, text, time);
    return li;
  });
  if (rows.length === 0) {
    rows.push(Object.assign(document.createElement("li"), {
      className: "py-2 text-xs text-zinc-400",
      textContent: "Rien pour l'instant : Booffer note ici chaque tâche terminée.",
    }));
  }
  $("history").replaceChildren(...rows);
}

async function refreshHooks() {
  const installed = await call("claude_hooks_installed");
  $("hooks-title").textContent = installed ? "✓ Claude Code est connecté" : "Claude Code n'est pas connecté";
  $("hooks-text").textContent = installed
    ? "Les hooks sont dans ~/.claude/settings.json."
    : "Ajoute les hooks de Booffer à ~/.claude/settings.json (tes réglages sont gardés, une copie de sauvegarde est faite).";
  $("install-hooks").classList.toggle("hidden", installed);
}

$("sleep").replaceChildren(
  ...SLEEP_CHOICES.map(([value, label]) => Object.assign(document.createElement("option"), { value, textContent: label })),
);

document.querySelectorAll("[data-theme-choice]").forEach((button) =>
  button.addEventListener("click", () => save({ theme: button.dataset.themeChoice })),
);
$("size").addEventListener("input", (e) => save({ size: Number(e.target.value) }));
document.querySelectorAll(".display-card").forEach((card) =>
  card.addEventListener("click", () => save({ display: card.dataset.display })),
);
$("custom-editor").addEventListener("keydown", (e) => {
  const id = e.target.value.trim().toLowerCase().replace(/\.exe$/, "");
  if (e.key !== "Enter" || !id) return;
  e.target.value = "";
  if (!settings.targetApps.includes(id)) save({ targetApps: [...settings.targetApps, id] });
});
$("follow").addEventListener("change", (e) => save({ follow: e.target.checked }));
$("sleep").addEventListener("change", (e) => save({ sleepAfter: Number(e.target.value) }));
$("sounds").addEventListener("change", (e) => save({ sounds: e.target.checked }));
$("volume").addEventListener("change", (e) => save({ volume: Number(e.target.value) }));
$("test-sound").addEventListener("click", () => playDone());
$("autostart").addEventListener("change", async (e) => {
  try {
    await call("set_autostart", { enabled: e.target.checked });
  } catch (error) {
    $("autostart-text").textContent = `Impossible : ${error}`;
  }
  e.target.checked = await call("get_autostart");
});
$("dnd-toggle").addEventListener("change", (e) => save({ dnd: e.target.checked }));
$("speech-toggle").addEventListener("change", (e) => save({ speech: e.target.checked }));
$("approvals").addEventListener("change", (e) => save({ approvals: e.target.checked }));
$("clear-history").addEventListener("click", () => {
  clearHistory();
  renderHistory();
});
// The ghost window writes the history: refresh when it changes or when we come back.
window.addEventListener("storage", renderHistory);
window.addEventListener("focus", renderHistory);
setInterval(renderHistory, 30_000);
$("install-hooks").addEventListener("click", async () => {
  try {
    await call("install_claude_hooks");
    $("hooks-text").textContent = "C'est fait. Relance Claude Code (ou ouvre /hooks) pour qu'il les charge.";
  } catch (error) {
    $("hooks-text").textContent = `Impossible : ${error}`;
  }
  refreshHooks();
});

// Another window (tray, ghost menu) may change settings too.
if (isTauri) {
  listen("settings-changed", ({ payload }) => {
    settings = payload;
    render();
  });
}

call("get_settings").then((loaded) => {
  settings = loaded;
  render();
});
refreshHooks();
call("get_autostart").then((on) => ($("autostart").checked = on));
renderHistory();

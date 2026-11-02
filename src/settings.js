import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { configureSound, playDone } from "./audio/chime.js";
import { duration } from "./core/format.js";
import { clearHistory, loadHistory, todayStats } from "./core/history.js";
import { setTheme } from "./core/theme.js";
import { ANIMATION_GROUPS, applyAnimations } from "./core/animations.js";
import { findUpdate, installUpdate } from "./core/updates.js";
import { createMascot } from "./ui/mascot.js";
import { createUsageView } from "./ui/usage-view.js";
import { createTokensView } from "./ui/tokens-view.js";
import { createLiveView } from "./ui/live-view.js";
import { PERKS, levelFor, loadXp } from "./core/level.js";
import { clockTime } from "./core/format.js";
import { compact as compactTokens } from "./core/models.js";
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
  // Claude Code and Codex in Windows Terminal (WindowsTerminal.exe).
  { id: "windowsterminal", name: "Terminal" },
  // Chrome / Edge / Brave, only while an AI chat tab is in front (src-tauri/src/web.rs).
  { id: "web-ai", name: "ChatGPT, Gemini… (navigateur)" },
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
  display: "editor", notifications: true, notifyWhenSilent: true, animationsOff: [], autoUpdate: true, targetApps: ["antigravity"], follow: false, glide: false, sounds: true, volume: 0.8,
  size: 1, skin: "classique", accessory: "aucun", sleepAfter: 45, approvals: true, theme: "auto", dnd: false, dndUntil: 0, speech: true,
  guard: true, dailyLimitPct: { anthropic: 100 }, repromptAi: false,
};
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const DEV_ANSWERS = {
  get_settings: () => ({ ...DEV_SETTINGS }),
  claude_hooks_status: () => "outdated",
  get_autostart: () => false,
  running_apps: () => [{ name: "Antigravity", processes: 14, memoryMb: 1840 }, { name: "Claude Code", processes: 2, memoryMb: 310 }],
  get_token_savers: () => ({ compactWindow: 200_000, concise: false, claudeCli: true }),
  set_compact_window: () => {},
  set_concise: () => {},
  model_usage: () => new Promise((resolve) => setTimeout(() => resolve(DEV_USAGE()), 600)),
};
function DEV_USAGE() {
  const day = (ago) => new Date(Date.now() - ago * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const rows = [];
  const add = (tool, model, ago, calls, input, output) => rows.push({ tool, model, day: day(ago), calls, input, output });
  for (let i = 0; i < 14; i++) {
    add("Claude Code", "claude-opus-5-5", i, 120 + ((i * 37) % 90), 40_000_000, 160_000);
    if (i % 3 !== 1) add("Antigravity", "Gemini 3.1 Pro", i, 200 + ((i * 53) % 140), 11_000_000, 1_400_000);
    if (i < 5) add("Antigravity", "Gemini 4 Argon (f3.8)", i, 30 + i * 4, 4_000_000, 30_000);
    if (i % 4 === 0) add("Codex", "gpt-6-astra", i, 25, 3_000_000, 9_000);
  }
  add("Antigravity", "gemini-3.8-flash-n", 2, 76, 7_800_000, 400_000);
  add("Claude Code", "claude-fable-5-1", 0, 18, 900_000, 12_000);
  return {
    rows,
    limits: [
      { tool: "Codex", windowMinutes: 300, usedPercent: 99, resetsAt: Date.now() + 2.2 * 3_600_000, seenAt: Date.now() - 600_000 },
      { tool: "Codex", windowMinutes: 10080, usedPercent: 24, resetsAt: Date.now() + 5.5 * 86_400_000, seenAt: Date.now() - 600_000 },
    ],
  };
}
const call = isTauri ? invoke : async (cmd, args) => DEV_ANSWERS[cmd]?.(args);

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
  $("editors-block").classList.toggle("opacity-40", settings.display !== "editor");
  // Old "follow" display mode: shown as « Partout » + « Suis-moi ».
  if (settings.display === "follow") document.querySelector('[data-display="everywhere"]').classList.add("selected");
  renderEditors();

  $("follow").checked = settings.follow || settings.display === "follow";
  $("glide").checked = settings.glide;
  $("sleep").value = String(settings.sleepAfter);
  $("sounds").checked = settings.sounds;
  $("volume").value = settings.volume;
  $("volume").disabled = !settings.sounds;
  $("approvals").checked = settings.approvals;
  $("guard-toggle").checked = settings.guard !== false;
  $("reprompt-ai").checked = Boolean(settings.repromptAi);
  $("dnd-toggle").checked = settings.dnd;
  $("dnd-until").textContent = settings.dnd && settings.dndUntil ? ` Jusqu'à ${clockTime(settings.dndUntil)}.` : "";
  $("speech-toggle").checked = settings.speech;
  $("notifications").checked = settings.notifications !== false;
  $("notify-silent").checked = settings.notifyWhenSilent !== false;
  $("auto-update").checked = settings.autoUpdate !== false;
  renderAnimations();
}

// Animations: one switch for all, and a chip per group (lit = animated).
const animationButtons = ANIMATION_GROUPS.map((group) => {
  const button = Object.assign(document.createElement("button"), { className: "chip", textContent: group.name, title: group.hint });
  button.addEventListener("click", () => {
    const off = new Set((settings.animationsOff ?? []).filter((id) => id !== "all"));
    off.has(group.id) ? off.delete(group.id) : off.add(group.id);
    save({ animationsOff: [...off] });
  });
  return { group, button };
});
$("anim-groups").replaceChildren(...animationButtons.map((a) => a.button));

function renderAnimations() {
  const off = settings.animationsOff ?? [];
  const all = off.includes("all");
  applyAnimations(off); // the preview ghost at the top of this page too
  $("anim-all").checked = !all;
  $("anim-groups-block").classList.toggle("opacity-40", all);
  for (const { group, button } of animationButtons) {
    button.classList.toggle("on", !all && !off.includes(group.id));
    button.disabled = all;
  }
  const count = off.filter((id) => id !== "all").length;
  $("anim-hint").textContent = all
    ? "Tout est coupé : réactive « Animer le fantôme » pour choisir."
    : count ? `${count} coupée${count > 1 ? "s" : ""}. Clique pour couper ou remettre une animation.` : "Clique pour couper ou remettre une animation.";
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
      textContent: [
        entry.project,
        entry.ms ? duration(entry.ms) : "",
        entry.files ? `${entry.files} fichier${entry.files > 1 ? "s" : ""}` : "",
        entry.tokens ? `💰 ${compactTokens(entry.tokens)} tokens${entry.pct === null || entry.pct === undefined ? "" : ` · ${entry.pct < 0.01 ? "< 1" : Math.round(entry.pct * 100)} %`}` : "",
      ]
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
      textContent: "Rien pour l'instant : Boofer note ici chaque tâche terminée.",
    }));
  }
  $("history").replaceChildren(...rows);
}

async function refreshHooks() {
  const status = await call("claude_hooks_status");
  const texts = {
    ok: ["✓ Claude Code est connecté", "Les hooks sont dans ~/.claude/settings.json (statut, demandes, compactage)."],
    outdated: ["Claude Code : mise à jour dispo", "Ajoute les nouveaux hooks (ex. voir quand le contexte se compacte)."],
    missing: ["Claude Code n'est pas connecté", "Ajoute les hooks de Boofer à ~/.claude/settings.json (tes réglages sont gardés, une copie de sauvegarde est faite)."],
  };
  const [title, text] = texts[status] ?? texts.missing;
  $("hooks-title").textContent = title;
  $("hooks-text").textContent = text;
  $("install-hooks").textContent = status === "outdated" ? "Mettre à jour" : "Connecter";
  $("install-hooks").classList.toggle("hidden", status === "ok");
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
$("follow").addEventListener("change", (e) =>
  save({ follow: e.target.checked, ...(settings.display === "follow" ? { display: "everywhere" } : {}) }),
);
$("glide").addEventListener("change", (e) => save({ glide: e.target.checked }));
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
// Here it has no end: for a while, it's the tray or the ghost's menu (they set dndUntil).
$("dnd-toggle").addEventListener("change", (e) => save({ dnd: e.target.checked, dndUntil: 0 }));
$("notifications").addEventListener("change", (e) => save({ notifications: e.target.checked }));
$("notify-silent").addEventListener("change", (e) => save({ notifyWhenSilent: e.target.checked }));
$("auto-update").addEventListener("change", (e) => save({ autoUpdate: e.target.checked }));
// Off then on again keeps the groups chosen before.
$("anim-all").addEventListener("change", (e) => {
  const groups = (settings.animationsOff ?? []).filter((id) => id !== "all");
  save({ animationsOff: e.target.checked ? groups : [...groups, "all"] });
});
document.querySelectorAll("[data-demo]").forEach((button) => {
  button.addEventListener("click", () => {
    if (isTauri) emit("demo", button.dataset.demo);
  });
});
$("speech-toggle").addEventListener("change", (e) => save({ speech: e.target.checked }));
$("approvals").addEventListener("change", (e) => save({ approvals: e.target.checked }));
$("guard-toggle").addEventListener("change", (e) => save({ guard: e.target.checked }));
$("reprompt-ai").addEventListener("change", (e) => save({ repromptAi: e.target.checked }));
$("clear-history").addEventListener("click", () => {
  clearHistory();
  renderHistory();
});
// The ghost window writes the history: refresh when it changes or when we come back.
window.addEventListener("storage", () => {
  renderHistory();
  renderLevel();
});

// The ghost grows with every finished task (core/level.js).
function renderLevel() {
  const lvl = levelFor(loadXp());
  $("level-num").textContent = `Niveau ${lvl.level}`;
  $("level-title").textContent = lvl.title;
  $("level-xp").textContent = lvl.to ? `${lvl.xp} / ${lvl.to} XP` : `${lvl.xp} XP`;
  $("level-bar").style.width = `${Math.round(lvl.progress * 100)}%`;
  const perk = Object.entries(PERKS).find(([level]) => Number(level) > lvl.level);
  $("level-next").textContent = perk ? `Niveau ${perk[0]} : ${perk[1]}` : "Tout est débloqué ✨";
  hero.dataset.tier = lvl.level >= 8 ? "gold" : lvl.level >= 5 ? "halo" : lvl.level >= 3 ? "glow" : "";
}
renderLevel();

// GitHub links open in the browser; a newer release shows up next to the version.
const REPO = "https://github.com/ItzSized/Boofer";
const openUrl = (url) => (isTauri ? call("open_url", { url }) : window.open(url, "_blank"));
$("repo-link").addEventListener("click", () => openUrl(REPO));
// Version and updates: « Rechercher » looks, then the same button installs (over this version).
let pendingUpdate = null;
const updateStatus = (text) => ($("update-status").textContent = text);

async function checkForUpdate() {
  if (!isTauri) return updateStatus("Les mises à jour se font dans l'appli installée.");
  const button = $("update-check");
  button.disabled = true;
  updateStatus("Recherche…");
  try {
    pendingUpdate = await findUpdate();
    if (pendingUpdate) {
      updateStatus(`✨ La version ${pendingUpdate.version} est disponible.`);
      button.textContent = `Installer ${pendingUpdate.version}`;
    } else {
      updateStatus(`✓ Tu as la dernière version (vérifié à ${clockTime(Date.now())}).`);
    }
  } catch {
    updateStatus("Impossible de vérifier : pas de connexion ?");
  }
  button.disabled = false;
}

async function installPending() {
  const button = $("update-check");
  button.disabled = true;
  $("update-bar").classList.remove("hidden");
  updateStatus(`Téléchargement de la version ${pendingUpdate.version}…`);
  try {
    await installUpdate(pendingUpdate, (p) => {
      $("update-fill").style.width = `${Math.round((p ?? 0.5) * 100)}%`;
      if (p === 1) updateStatus("Installation… Boofer va redémarrer tout seul.");
    });
  } catch (e) {
    updateStatus(`Échec de la mise à jour : ${e}`);
    $("update-bar").classList.add("hidden");
    button.disabled = false;
  }
}

$("update-check").addEventListener("click", () => (pendingUpdate ? installPending() : checkForUpdate()));
(async () => {
  const current = isTauri ? await (await import("@tauri-apps/api/app")).getVersion() : "0.3.7";
  $("version").textContent = current;
})();
window.addEventListener("focus", () => {
  renderHistory();
  if (page === "models") usage.refresh();
});
setInterval(() => {
  renderHistory();
  if (page === "models") usage.refresh();
}, 30_000);

// Two pages: settings, and the usage of each model (tray → « Usage des modèles… »).
let page = "settings";
function showPage(next) {
  page = ["models", "live", "tokens"].includes(next) ? next : "settings";
  document.querySelectorAll("[data-page]").forEach((tab) => tab.classList.toggle("selected", tab.dataset.page === page));
  for (const name of ["settings", "models", "live", "tokens"]) $(`page-${name}`).classList.toggle("hidden", page !== name);
  if (page === "models") usage.refresh();
  if (page === "tokens") tokens.refresh();
  if (page === "live") live.start();
  else live.stop();
  window.history.replaceState(null, "", `#${page}`);
}
document.querySelectorAll("[data-page]").forEach((tab) => tab.addEventListener("click", () => showPage(tab.dataset.page)));
const usage = createUsageView({ call, settings: () => settings, save });
const tokens = createTokensView({ call, isTauri });
const live = createLiveView({ call, isTauri, emit, listen });
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
    usage.rerender();
  });
  listen("settings-page", ({ payload }) => showPage(payload));
}

call("get_settings").then((loaded) => {
  settings = loaded;
  render();
});
refreshHooks();
call("get_autostart").then((on) => ($("autostart").checked = on));
renderHistory();
showPage(location.hash.slice(1));

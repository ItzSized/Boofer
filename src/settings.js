import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { configureSound, playDone } from "./audio/chime.js";
import { createMascot } from "./ui/mascot.js";
import "./style.css";
import "./settings.css";

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
  size: 1, skin: "classique", accessory: "aucun", sleepAfter: 45, approvals: true,
};
const call = isTauri ? invoke : async (cmd) => (cmd === "get_settings" ? { ...DEV_SETTINGS } : cmd === "claude_hooks_installed" ? false : undefined);

const $ = (id) => document.getElementById(id);
const hero = $("hero");
createMascot(hero);

let settings = null;

async function save(change) {
  settings = { ...settings, ...change };
  render();
  await call("set_settings", { settings });
}

function render() {
  hero.dataset.skin = settings.skin;
  hero.dataset.accessory = settings.accessory;
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
$("approvals").addEventListener("change", (e) => save({ approvals: e.target.checked }));
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

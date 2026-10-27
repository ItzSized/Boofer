import { createMascot } from "../../src/ui/mascot.js";
import { configureSound, playAttention, playDone, playPat } from "../../src/audio/chime.js";
import "./style.css";

export function initWebsite() {
  document.documentElement.dataset.mode = "website";
  if (!document.documentElement.dataset.theme) {
    document.documentElement.dataset.theme = "dark";
  }
  configureSound({ sounds: true, volume: 0.7 });

  const $ = (id) => document.getElementById(id);

  // 1. Mount mascots
  const navGhostEl = $("nav-ghost");
  const heroGhostEl = $("hero-ghost");
  const customizerGhostEl = $("customizer-ghost");
  if (!navGhostEl || !heroGhostEl || !customizerGhostEl) return;

  createMascot(navGhostEl);
  const heroMascot = createMascot(heroGhostEl);
  const customizerMascot = createMascot(customizerGhostEl);

  // 2. Theme toggle
  let theme = "dark";
  const themeBtn = $("theme-btn");
  themeBtn.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === "dark" ? "☀️ Clair" : "🌙 Sombre";
  });

  // 3. Auto-detect visitor OS for primary download button
  (function detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    const icon = $("hero-dl-icon");
    const title = $("hero-dl-title");
    const sub = $("hero-dl-sub");
    const link = $("hero-primary-dl");

    if (ua.includes("mac")) {
      icon.textContent = "🍎";
      title.textContent = "Télécharger pour macOS";
      sub.textContent = "Apple Silicon (M1–M4) & Intel · .dmg";
      link.href = "https://github.com/ItzSized/Boofer/releases/latest/download/Booffer_0.1.0_aarch64.dmg";
      link.removeAttribute("download");
      $("dl-card-macos")?.classList.add("ring-2", "ring-blue-500");
    } else if (ua.includes("linux")) {
      icon.textContent = "🐧";
      title.textContent = "Télécharger pour Linux";
      sub.textContent = "AppImage universel, Ubuntu/Debian (.deb) & Fedora (.rpm)";
      link.href = "https://github.com/ItzSized/Boofer/releases/latest/download/Booffer_0.1.0_amd64.AppImage";
      link.removeAttribute("download");
      $("dl-card-linux")?.classList.add("ring-2", "ring-amber-500");
    }
  })();

  // 4. Eye tracking for hero and customizer ghosts
  window.addEventListener("mousemove", (e) => {
    for (const el of [heroGhostEl, customizerGhostEl, navGhostEl]) {
      const body = el.querySelector(".body")?.getBoundingClientRect();
      if (!body || !body.width) continue;
      const dx = e.clientX - (body.left + body.width / 2);
      const dy = e.clientY - (body.top + body.height * 0.47);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(2.6, d / 30) / d;
      el.style.setProperty("--look-x", `${(dx * reach).toFixed(2)}px`);
      el.style.setProperty("--look-y", `${(dy * reach).toFixed(2)}px`);
    }
  });

  // 5. Speech bubble + Patting hearts on hero & customizer ghosts
  const HEART_SVG = `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3.2 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.8 0 6.1 3.9 4.6 7.3C19.5 16.4 12 21 12 21z"/></svg>`;
  let speechTimer = null;

  function sayHero(text) {
    const el = $("hero-speech");
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(speechTimer);
    speechTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function patGhost(el, mascotObj) {
    el.classList.remove("sleeping");
    mascotObj.flash("patted", 900);
    playPat();
    const lines = ["Hihi ! ♥", "Ça chatouille !", "Encore ! 👻", "Boo ♥", "Prêt à coder !"];
    sayHero(lines[Math.floor(Math.random() * lines.length)]);

    const fx = $("hero-fx");
    if (!fx) return;
    for (let i = 0; i < 3; i++) {
      const heart = document.createElement("div");
      heart.className = "heart";
      heart.innerHTML = HEART_SVG;
      heart.style.left = `${45 + Math.random() * 40}px`;
      heart.style.top = `18px`;
      heart.style.setProperty("--dx", `${(Math.random() - 0.5) * 55}px`);
      heart.style.animationDelay = `${i * 100}ms`;
      fx.append(heart);
      setTimeout(() => heart.remove(), 1400);
    }
  }

  heroGhostEl.addEventListener("click", () => patGhost(heroGhostEl, heroMascot));
  customizerGhostEl.addEventListener("click", () => patGhost(customizerGhostEl, customizerMascot));

  // 6. Live Hero Simulator Scenarios
  const SCENARIOS = {
    argon: {
      state: "tool",
      color: "#4285F4",
      windowTitle: "Antigravity IDE — Claudio · src-tauri/src/usage.rs",
      terminal: "▸ [Gemini 4 Argon · f3.8] Analyse des transcripts et compilation en cours…",
      title: "Claudio · Antigravity · Gemini 4 Argon (f3.8)",
      pct: "68%",
      prompt: "« Ajoute Antigravity Gemini 4 Argon & f3.8 »",
      stepName: "Étape 2/3 · Intègre usage.rs",
      stepPct: "80%",
      label: "▸ Modifie src-tauri/src/usage.rs",
      meta: "⏱ 34 s · reste ≈ 15 s · 9 actions · 4 fichiers",
      speech: "Gemini 4 Argon carbure ! 🚀",
    },
    flash: {
      state: "streaming",
      color: "#38bdf8",
      windowTitle: "Antigravity IDE — Claudio · src/agents/antigravity.js",
      terminal: "▸ [Gemini 3.8 Flash] Génération ultra-rapide de l'adaptateur temps réel…",
      title: "Claudio · Antigravity · Gemini 3.8 Flash",
      pct: "84%",
      prompt: "« Optimise le watcher temps réel »",
      stepName: "Étape 3/3 · Vérifie les événements",
      stepPct: "90%",
      label: "▸ Écrit src/agents/antigravity.js",
      meta: "⏱ 9 s · reste ≈ 3 s · 6 actions · 2 fichiers",
      speech: "Flash va à toute vitesse ⚡",
    },
    claude: {
      state: "tool",
      color: "#D97757",
      windowTitle: "Cursor — api · src/server.ts",
      terminal: "▸ [Claude Opus 4.6] Exécution de la suite de tests unitaires…",
      title: "api · Claude Code · claude-opus-4-6",
      pct: "52%",
      prompt: "« Sécurise les routes d'authentification »",
      stepName: "Étape 2/4 · Ajoute les tests JWT",
      stepPct: "60%",
      label: "▸ Lance : npm test",
      meta: "⏱ 48 s · reste ≈ 40 s · 14 actions · 5 fichiers · 1 sous-agent",
      speech: "Claude vérifie les tests 🧪",
    },
  };

  function applyScenario(key) {
    document.querySelectorAll(".sim-btn").forEach((b) => {
      b.classList.toggle("pill-active", b.dataset.simAction === key);
    });
    heroGhostEl.classList.remove("sleeping");
    $("sim-ask").classList.add("hidden");
    $("sim-ask").classList.remove("flex");
    $("sim-bubble").classList.remove("hidden");

    if (key === "permission") {
      heroMascot.setState("attention", "#D97757");
      $("sim-bubble").classList.add("hidden");
      $("sim-ask").classList.remove("hidden");
      $("sim-ask").classList.add("flex");
      playAttention();
      sayHero("Psst… il a besoin de toi 🙏");
      return;
    }

    if (key === "done") {
      heroMascot.setState("done", "#4ade80");
      heroMascot.celebrate();
      playDone();
      $("sim-title").textContent = "Claudio a fini !";
      $("sim-pct").textContent = "✨";
      $("sim-step-box").classList.add("hidden");
      $("sim-label").textContent = "Terminé en 28 s";
      $("sim-meta").textContent = "12 actions · 5 fichiers modifiés";
      $("sim-bar").style.width = "100%";
      $("sim-bar").style.background = "#4ade80";
      sayHero("Tadaa ! Mission accomplie ✨");
      return;
    }

    if (key === "sleep") {
      heroMascot.setState("idle", "#a78bfa");
      heroGhostEl.classList.add("sleeping");
      sayHero("Zzz… petite sieste 🌙");
      return;
    }

    const s = SCENARIOS[key] ?? SCENARIOS.argon;
    heroMascot.setState(s.state, s.color);
    $("sim-window-title").textContent = s.windowTitle;
    $("sim-terminal-line").textContent = s.terminal;
    $("sim-dot").style.background = s.color;
    $("sim-title").textContent = s.title;
    $("sim-pct").textContent = s.pct;
    $("sim-prompt").textContent = s.prompt;
    $("sim-step-box").classList.remove("hidden");
    $("sim-step-name").textContent = s.stepName;
    $("sim-step-pct").textContent = s.stepPct;
    $("sim-step-bar").style.width = s.stepPct;
    $("sim-step-bar").style.background = s.color;
    $("sim-label").textContent = s.label;
    $("sim-meta").textContent = s.meta;
    $("sim-bar").style.width = s.pct;
    $("sim-bar").style.background = s.color;
    sayHero(s.speech);
  }

  document.querySelectorAll(".sim-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyScenario(btn.dataset.simAction));
  });

  document.querySelectorAll("[data-sim-tab]").forEach((tab) => {
    tab.addEventListener("click", () => applyScenario(tab.dataset.simTab));
  });

  document.querySelectorAll("[data-sim-decision]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const decision = btn.dataset.simDecision;
      if (decision === "deny") {
        sayHero("Commande refusée 🛑");
        applyScenario("argon");
      } else {
        sayHero("Autorisé ! C'est parti 🚀");
        applyScenario("done");
      }
    });
  });

  // 7. Interactive Skins & Accessories Studio
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

  let chosenSkin = "classique";
  let chosenAccessory = "couronne";

  const skinCards = SKINS.map((skin) => {
    const btn = document.createElement("button");
    btn.className = "flex flex-col items-center rounded-2xl p-2 ring-1 ring-black/10 dark:ring-white/15 hover:bg-violet-500/10 cursor-pointer transition";
    const mini = document.createElement("div");
    mini.className = "mascot site-mini";
    mini.dataset.state = "idle";
    mini.dataset.skin = skin.id;
    mini.dataset.accessory = chosenAccessory;
    createMascot(mini);
    const label = document.createElement("span");
    label.className = "mt-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300";
    label.textContent = skin.name;
    btn.append(mini, label);
    btn.addEventListener("click", () => {
      chosenSkin = skin.id;
      updateCustomizer();
      playPat();
    });
    return { skin, btn, mini };
  });
  $("site-skins").replaceChildren(...skinCards.map((c) => c.btn));

  const accChips = ACCESSORIES.map((acc) => {
    const btn = document.createElement("button");
    btn.className = "rounded-xl px-3.5 py-2 text-xs font-semibold ring-1 ring-black/10 dark:ring-white/15 hover:bg-violet-500/10 cursor-pointer transition";
    btn.textContent = acc.name;
    btn.addEventListener("click", () => {
      chosenAccessory = acc.id;
      updateCustomizer();
      playPat();
    });
    return { acc, btn };
  });
  $("site-accessories").replaceChildren(...accChips.map((a) => a.btn));

  function updateCustomizer() {
    customizerGhostEl.dataset.skin = chosenSkin;
    customizerGhostEl.dataset.accessory = chosenAccessory;
    heroGhostEl.dataset.skin = chosenSkin;
    heroGhostEl.dataset.accessory = chosenAccessory;
    navGhostEl.dataset.skin = chosenSkin;

    for (const { skin, btn, mini } of skinCards) {
      const active = skin.id === chosenSkin;
      btn.classList.toggle("ring-2", active);
      btn.classList.toggle("ring-violet-500", active);
      btn.classList.toggle("bg-violet-500/15", active);
      mini.dataset.accessory = chosenAccessory;
    }
    for (const { acc, btn } of accChips) {
      btn.classList.toggle("pill-active", acc.id === chosenAccessory);
    }
    const skinName = SKINS.find((s) => s.id === chosenSkin)?.name ?? "";
    const accName = ACCESSORIES.find((a) => a.id === chosenAccessory)?.name ?? "";
    $("customizer-caption").textContent = `Skin ${skinName} · ${accName}`;
  }
  updateCustomizer();

  // 8. Interactive Model Usage Dashboard Preview
  const USAGE_DATA = {
    today: [
      { tool: "Antigravity", color: "#4285F4", model: "Gemini 4 Argon (f3.8)", calls: 38, input: "612,4 k", output: "34,2 k", pct: 100 },
      { tool: "Antigravity", color: "#38bdf8", model: "Gemini 3.8 Flash", calls: 19, input: "204,0 k", output: "15,8 k", pct: 50 },
      { tool: "Claude Code", color: "#D97757", model: "claude-opus-4-6", calls: 14, input: "310,2 k", output: "18,4 k", pct: 37 },
      { tool: "Antigravity", color: "#60a5fa", model: "Gemini 3.5 Flash", calls: 9, input: "98,5 k", output: "7,1 k", pct: 24 },
    ],
    "7d": [
      { tool: "Antigravity", color: "#4285F4", model: "Gemini 4 Argon (f3.8)", calls: 94, input: "1,5 M", output: "86,0 k", pct: 100 },
      { tool: "Claude Code", color: "#D97757", model: "claude-opus-4-6", calls: 62, input: "1,2 M", output: "64,5 k", pct: 66 },
      { tool: "Antigravity", color: "#38bdf8", model: "Gemini 3.8 Flash", calls: 47, input: "520,0 k", output: "39,2 k", pct: 50 },
      { tool: "Antigravity", color: "#60a5fa", model: "Gemini 3.5 Flash", calls: 31, input: "340,0 k", output: "22,9 k", pct: 33 },
      { tool: "Codex", color: "#10a37f", model: "codex-mini-latest", calls: 18, input: "215,0 k", output: "14,0 k", pct: 19 },
    ],
    "30d": [
      { tool: "Antigravity", color: "#4285F4", model: "Gemini 4 Argon (f3.8)", calls: 215, input: "3,6 M", output: "198,4 k", pct: 100 },
      { tool: "Claude Code", color: "#D97757", model: "claude-opus-4-6", calls: 164, input: "3,1 M", output: "172,0 k", pct: 76 },
      { tool: "Antigravity", color: "#38bdf8", model: "Gemini 3.8 Flash", calls: 112, input: "1,3 M", output: "94,1 k", pct: 52 },
      { tool: "Claude Code", color: "#D97757", model: "claude-sonnet-4-6", calls: 88, input: "1,1 M", output: "68,3 k", pct: 41 },
      { tool: "Antigravity", color: "#60a5fa", model: "Gemini 3.5 Flash", calls: 74, input: "820,0 k", output: "51,0 k", pct: 34 },
    ],
    all: [
      { tool: "Antigravity", color: "#4285F4", model: "Gemini 4 Argon (f3.8)", calls: 312, input: "5,2 M", output: "284,0 k", pct: 100 },
      { tool: "Claude Code", color: "#D97757", model: "claude-opus-4-6", calls: 240, input: "4,5 M", output: "251,0 k", pct: 77 },
      { tool: "Antigravity", color: "#38bdf8", model: "Gemini 3.8 Flash", calls: 158, input: "1,8 M", output: "128,4 k", pct: 51 },
      { tool: "Antigravity", color: "#60a5fa", model: "Gemini 3.5 Flash", calls: 119, input: "1,3 M", output: "89,2 k", pct: 38 },
      { tool: "Codex", color: "#10a37f", model: "codex", calls: 64, input: "740,0 k", output: "48,9 k", pct: 21 },
    ],
  };

  const TOTALS = {
    today: { calls: "80", in: "1,2 M", out: "75,5 k" },
    "7d": { calls: "252", in: "3,8 M", out: "226,6 k" },
    "30d": { calls: "653", in: "9,9 M", out: "583,8 k" },
    all: { calls: "893", in: "13,5 M", out: "801,5 k" },
  };

  function renderSiteUsage(range) {
    document.querySelectorAll(".site-range-btn").forEach((b) => {
      b.classList.toggle("pill-active", b.dataset.siteRange === range);
    });
    const tot = TOTALS[range] ?? TOTALS.all;
    $("site-stat-calls").textContent = tot.calls;
    $("site-stat-in").textContent = tot.in;
    $("site-stat-out").textContent = tot.out;

    const rows = (USAGE_DATA[range] ?? USAGE_DATA.all).map((r) => {
      const li = document.createElement("li");
      li.className = "py-2.5 text-xs";
      li.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="size-2.5 shrink-0 rounded-full" style="background:${r.color}"></span>
          <span class="rounded-md bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">${r.tool}</span>
          <span class="truncate font-bold text-zinc-900 dark:text-zinc-100">${r.model}</span>
        </div>
        <span class="shrink-0 tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
          <strong class="text-zinc-800 dark:text-zinc-200">${r.calls}</strong> appels · ${r.input} lus · ${r.output} écrits
        </span>
      </div>
      <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div class="h-full rounded-full transition-[width] duration-500" style="width:${r.pct}%;background:${r.color}"></div>
      </div>`;
      return li;
    });
    $("site-usage-list").replaceChildren(...rows);
  }

  document.querySelectorAll(".site-range-btn").forEach((btn) => {
    btn.addEventListener("click", () => renderSiteUsage(btn.dataset.siteRange));
  });
  renderSiteUsage("all");

  // 9. Copy CLI command button
  $("copy-cli-btn")?.addEventListener("click", async () => {
    const code = $("cli-code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(code);
      $("copy-cli-btn").textContent = "✓ Copié !";
      setTimeout(() => ($("copy-cli-btn").textContent = "📋 Copier les commandes"), 2000);
    } catch {
      // ignore
    }
  });

  setTimeout(() => sayHero("Coucou ! Passe ta souris ou clique-moi 👻"), 700);
}

if (document.getElementById("nav-ghost")) {
  initWebsite();
}

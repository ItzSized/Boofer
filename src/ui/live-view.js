import { approx, diskLabel, duration } from "../core/format.js";
import { compact } from "../core/models.js";
import { CONTEXT_PARTS } from "../core/task-cost.js";

/** Asks the ghost window for its sessions this often while the page is shown. */
const POLL_MS = 1500;
const APPS_MS = 5000;

const STATES = {
  thinking: ["💭 Thinking", "bg-violet-100 text-violet-700 dark:bg-violet-950/70 dark:text-violet-300"],
  tool: ["🛠️ Working", "bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300"],
  streaming: ["✍️ Writing", "bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300"],
  compacting: ["🧹 Compacting", "bg-purple-100 text-purple-700 dark:bg-purple-950/70 dark:text-purple-300"],
  attention: ["✋ Waiting for you", "bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300"],
  done: ["✅ Done", "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300"],
  error: ["⚠️ Error", "bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"],
  idle: ["💤 Idle", "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"],
};

/** "What fills the context": a stacked bar and its legend, biggest parts first. */
function contextDetail(parts, total, key, open) {
  if (!parts?.length || !total) return "";
  const sum = parts.reduce((t, p) => t + p.tokens, 0) || 1;
  const bar = parts
    .map((p) => `<div style="width:${(p.tokens / sum) * 100}%;background:${(CONTEXT_PARTS[p.key] ?? ["", "#a1a1aa"])[1]}" title="${esc(CONTEXT_PARTS[p.key]?.[0] ?? p.key)}"></div>`)
    .join("");
  const legend = parts
    .map((p) => {
      const [name, color] = CONTEXT_PARTS[p.key] ?? [p.key, "#a1a1aa"];
      const pct = Math.round((p.tokens / sum) * 100);
      return `<li class="flex items-center gap-1.5"><span class="size-2 shrink-0 rounded-sm" style="background:${color}"></span>
        <span class="flex-1 truncate">${esc(name)}</span>
        <span class="tabular-nums text-zinc-400">${compact(p.tokens)}</span>
        <span class="w-9 text-right tabular-nums font-medium">${pct < 1 ? "< 1" : pct} %</span></li>`;
    })
    .join("");
  return `<details data-key="${esc(key)}" ${open ? "open" : ""} class="mt-1.5 rounded-lg bg-zinc-50 px-2 py-1.5 dark:bg-zinc-800/60">
    <summary class="cursor-pointer select-none text-[11px] font-medium text-zinc-600 dark:text-zinc-300">What fills the context</summary>
    <div class="mt-1.5 flex h-2 overflow-hidden rounded-full">${bar}</div>
    <ul class="mt-1.5 space-y-0.5 text-[11px]">${legend}</ul>
    <p class="mt-1 text-[10px] text-zinc-400">Estimated from the size of each item, adjusted to the real total.</p>
  </details>`;
}

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * "🟢 Live" page of the settings window: the AI apps open on the PC, and every
 * agent session the ghost knows about, with its model, context tokens and time left.
 * The sessions live in the ghost window: this page asks for them ("live-request")
 * and it answers ("live-sessions").
 */
export function createLiveView({ call, isTauri, emit, listen }) {
  const $ = (id) => document.getElementById(id);
  let sessions = null;
  let timers = [];

  if (isTauri) {
    listen("live-sessions", ({ payload }) => {
      sessions = payload;
      renderSessions();
    });
  }

  async function refreshApps() {
    const apps = (await call("running_apps").catch(() => [])) ?? [];
    $("live-apps").innerHTML = apps.length
      ? apps
        .map(
          (a) => `<span class="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs dark:bg-zinc-800">
            <span class="size-2 rounded-full bg-emerald-500"></span>
            <span class="font-semibold">${esc(a.name)}</span>
            <span class="tabular-nums text-zinc-500 dark:text-zinc-400">${a.memoryMb >= 1024 ? `${(a.memoryMb / 1024).toFixed(1)} GB` : `${a.memoryMb} MB`}</span>
          </span>`,
        )
        .join("")
      : `<span class="text-xs text-zinc-400">No AI app open (Claude Code, Antigravity, Codex, Cursor, VS Code…).</span>`;
  }

  function renderSessions() {
    const list = sessions ?? [];
    const working = list.filter((s) => !["idle", "done"].includes(s.state)).length;
    $("live-summary").textContent = list.length
      ? `${list.length} session${list.length > 1 ? "s" : ""} · ${working} working`
      : "";
    if (sessions === null) {
      $("live-sessions").innerHTML = `<li class="py-4 text-center text-xs text-zinc-400"><span class="spinner"></span></li>`;
      return;
    }
    if (list.length === 0) {
      $("live-sessions").innerHTML = `<li class="py-5 text-center text-xs text-zinc-400">No agent running. Start a task in Claude Code, Antigravity or Codex.</li>`;
      return;
    }
    // The page is redrawn every 1.5 s: keep each "What fills the context" open or closed.
    const open = new Set([...$("live-sessions").querySelectorAll("details[open]")].map((el) => el.dataset.key));
    $("live-sessions").innerHTML = list
      .map((s) => {
        const [stateText, stateClass] = STATES[s.state] ?? STATES.idle;
        const ctx = s.context?.tokens ? Math.min(100, Math.round((s.context.tokens / s.context.window) * 100)) : null;
        const facts = [
          s.elapsedMs ? `⏱ ${duration(s.elapsedMs)}` : "",
          s.etaMs === null || s.etaMs === undefined ? "" : s.etaMs < 5000 ? "almost done…" : `${approx(s.etaMs)} left`,
          s.steps ? `${s.steps} action${s.steps > 1 ? "s" : ""}` : "",
          s.files ? `${s.files} file${s.files > 1 ? "s" : ""}` : "",
        ].filter(Boolean);
        const pct = s.progress === null || s.progress === undefined ? null : Math.round(s.progress * 100);
        return `<li class="py-3">
          <div class="flex items-center gap-2">
            <span class="size-2.5 shrink-0 rounded-full ${["idle", "done"].includes(s.state) ? "" : "animate-pulse"}" style="background:${esc(s.color)}"></span>
            <span class="truncate text-sm font-semibold">${esc(s.project || s.agent)}</span>
            <span class="shrink-0 rounded bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">${esc(s.agent)}</span>
            <span class="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${stateClass}">${stateText}</span>
          </div>
          <div class="mt-1 pl-4.5 text-xs">
            ${s.model ? `<p class="text-zinc-500 dark:text-zinc-400">🤖 ${esc(s.model)}</p>` : ""}
            ${s.prompt ? `<p class="truncate italic text-zinc-400">“${esc(s.prompt)}”</p>` : ""}
            ${s.label && s.state !== "idle" ? `<p class="truncate font-medium text-zinc-700 dark:text-zinc-200">▸ ${esc(s.label)}</p>` : ""}
            ${facts.length ? `<p class="text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">${facts.join(" · ")}</p>` : ""}
            ${pct !== null && s.state !== "idle" ? `<div class="mt-1 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div class="h-full rounded-full" style="width:${pct}%;background:${esc(s.color)}"></div></div>
              <span class="tabular-nums">${pct}%</span></div>` : ""}
            ${ctx !== null ? `<div class="mt-1 flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400" title="Tokens in the session context / when it gets compacted">
              <span class="shrink-0">🧠 ${compact(s.context.tokens)} / ${compact(s.context.window)} tokens</span>
              <div class="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div class="h-full rounded-full ${ctx >= 80 ? "bg-amber-500" : "bg-violet-400"}" style="width:${ctx}%"></div></div>
              <span class="tabular-nums">${ctx}%</span></div>` : ""}
            ${s.disk ? `<p class="mt-1 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400" title="What Claude Code keeps on your PC in ~/.claude/projects: this chat with its subagents, and all the chats of the project. It takes disk space, not tokens: the context gauge is what each message costs.">On disk: ${esc(diskLabel(s.disk))}</p>` : ""}
            ${s.cost ? `<p class="mt-1 text-[11px] font-medium tabular-nums text-violet-600 dark:text-violet-300" title="Tokens used by this task since your request (input + output), and their share of your daily limit (📊 Models)">${esc(s.cost.label)} ${["idle", "done"].includes(s.state) ? "" : "so far"}</p>` : ""}
            ${contextDetail(s.contextParts, s.context?.tokens, s.key, open.has(s.key))}
          </div>
        </li>`;
      })
      .join("");
  }

  const DEV_SESSIONS = () => [
    { key: "a", agent: "Claude Code", color: "#D97757", project: "Boofer", state: "tool", label: "Editing main.js", model: "Claude Opus 5.5", prompt: "Add the live page", elapsedMs: 95_000, etaMs: 140_000, steps: 14, files: 3, progress: 0.42, context: { tokens: 312_000, window: 1_000_000 },
      disk: { chatBytes: 135_266_304, projectBytes: 799_014_912, chats: 3 },
      cost: { tokens: 1_240_000, pct: 0.018, label: "💰 1.2M tokens · 2% of your daily limit" },
      contextParts: [{ key: "files", tokens: 118_000 }, { key: "system", tokens: 64_000 }, { key: "commands", tokens: 52_000 }, { key: "replies", tokens: 41_000 }, { key: "toolCalls", tokens: 21_000 }, { key: "prompts", tokens: 9_000 }, { key: "search", tokens: 7_000 }] },
    { key: "b", agent: "Antigravity", color: "#4285F4", project: "website", state: "idle", label: "Waiting for your request", model: "Gemini 3.1 Pro", elapsedMs: 0, etaMs: null, steps: 0, files: 0, progress: null, context: null },
  ];

  return {
    start() {
      this.stop();
      renderSessions();
      refreshApps();
      const ask = () => (isTauri ? emit("live-request") : ((sessions = DEV_SESSIONS()), renderSessions()));
      ask();
      timers = [setInterval(ask, POLL_MS), setInterval(refreshApps, APPS_MS)];
    },
    stop() {
      timers.forEach(clearInterval);
      timers = [];
    },
  };
}

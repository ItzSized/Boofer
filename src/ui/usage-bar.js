import { compact, describeModel, familyColor, localDay, summarize } from "../core/models.js";

const REFRESH_MS = 30_000;
const SHOWN = 3;

/**
 * Small card under the ghost: today's top models (falls back to the last 7 days).
 * Clicking it opens the full « 📊 Modèles » page of the settings window.
 */
export function createUsageBar(el, { isTauri, invoke, onData = () => {} }) {
  el.className =
    "pointer-events-auto mt-1.5 w-[224px] cursor-pointer rounded-2xl bg-white/95 px-3 py-2 shadow-md ring-1 ring-black/5 " +
    "transition hover:ring-violet-400 dark:bg-zinc-900/95 dark:ring-white/10";
  el.title = "Voir l'usage de chaque modèle";
  el.innerHTML = `
    <div class="flex items-center gap-1.5 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
      <span class="font-semibold text-zinc-700 dark:text-zinc-200">📊 Modèles</span>
      <span data-period></span>
      <span class="ml-auto">tout voir ›</span>
    </div>
    <div data-rows class="mt-1 space-y-1"></div>`;
  const periodEl = el.querySelector("[data-period]");
  const rowsEl = el.querySelector("[data-rows]");

  let rows = null;
  let activeModel = null;

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isTauri) invoke("open_settings", { page: "models" });
  });

  function render() {
    let period = "aujourd'hui";
    let models = summarize(rows, localDay(0));
    if (models.length === 0) {
      period = "7 jours";
      models = summarize(rows, localDay(6));
    }
    el.classList.toggle("hidden", models.length === 0);
    periodEl.textContent = `· ${period}`;
    const peak = Math.max(1, ...models.map((m) => m.calls));
    rowsEl.innerHTML = models
      .slice(0, SHOWN)
      .map((m) => {
        const color = familyColor(m.family);
        const live = activeModel && m.name === activeModel;
        return `<div>
          <div class="flex items-center gap-1.5 text-[10.5px] leading-3.5">
            <span class="size-2 shrink-0 rounded-full ${live ? "animate-pulse" : ""}" style="background:${color}"></span>
            <span class="truncate font-medium text-zinc-700 dark:text-zinc-200">${m.name}</span>
            <span class="ml-auto shrink-0 tabular-nums text-[9.5px] text-zinc-500 dark:text-zinc-400">${compact(m.calls)} rép.</span>
          </div>
          <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div class="h-full rounded-full" style="width:${Math.max(6, Math.round((m.calls / peak) * 100))}%;background:${color}"></div>
          </div>
        </div>`;
      })
      .join("");
  }

  async function refresh() {
    if (!isTauri) {
      rows = [
        { tool: "Antigravity", model: "Gemini 3.1 Pro", day: localDay(0), calls: 42, input: 640_000, output: 48_000 },
        { tool: "Claude Code", model: "claude-opus-5-5", day: localDay(0), calls: 31, input: 95_000, output: 9_200 },
        { tool: "Antigravity", model: "Gemini 4 Argon (f3.8)", day: localDay(0), calls: 12, input: 180_000, output: 14_000 },
      ];
      render();
      return onData({ rows, limits: [] });
    }
    try {
      const usage = await invoke("model_usage", { tzOffsetMinutes: new Date().getTimezoneOffset() });
      rows = usage.rows;
      render();
      onData(usage);
    } catch {
      // try again at the next refresh
    }
  }

  el.classList.add("hidden");
  queueMicrotask(refresh); // after the caller has finished setting up
  setInterval(refresh, REFRESH_MS);

  return {
    el,
    refresh,
    /** Highlights the model the selected session is using. */
    setActiveSession(session) {
      const next = session?.details?.model ? describeModel(session.details.model).name : null;
      if (next !== activeModel) {
        activeModel = next;
        if (rows) render();
      }
    },
  };
}

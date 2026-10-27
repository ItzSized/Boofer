import { FAMILIES, compact, describeModel, familyColor, localDay, summarize } from "../core/models.js";

const RANGES = { today: 0, "7d": 6, "30d": 29, all: null };
const RANGE_KEY = "booffer.usageRange";
const SPARK_DAYS = 14;

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n, word) => `${n.toLocaleString("fr-FR")} ${word}${n > 1 ? "s" : ""}`;

function lastUsed(day) {
  if (day === localDay(0)) return "aujourd'hui";
  if (day === localDay(1)) return "hier";
  for (let i = 2; i < 7; i++) if (day === localDay(i)) return `il y a ${i} jours`;
  const [y, m, d] = day.split("-").map(Number);
  return `le ${new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;
}

function timeLeft(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.round(h / 24)} j`;
}

/**
 * « 📊 Modèles » page of the settings window: which AI models were used, how much,
 * and the plan limits we know of. Only models found in the local files are listed.
 */
export function createUsageView({ call }) {
  const $ = (id) => document.getElementById(id);
  let data = null;
  let loading = false;
  let range = "7d";
  try {
    range = localStorage.getItem(RANGE_KEY) in RANGES ? localStorage.getItem(RANGE_KEY) : range;
  } catch {
    // per-viewer convenience only
  }

  document.querySelectorAll("[data-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      range = btn.dataset.range;
      try {
        localStorage.setItem(RANGE_KEY, range);
      } catch {
        // ignore
      }
      render();
    }),
  );
  // Colors depend on the theme.
  new MutationObserver(() => data && render()).observe(document.documentElement, { attributeFilter: ["data-theme"] });

  function render() {
    document.querySelectorAll("[data-range]").forEach((btn) => btn.classList.toggle("selected", btn.dataset.range === range));
    $("usage-loading").classList.toggle("hidden", Boolean(data));
    $("usage-body").classList.toggle("hidden", !data);
    if (!data) return;

    const days = RANGES[range];
    const models = summarize(data.rows, days === null ? "" : localDay(days));
    const calls = models.reduce((sum, m) => sum + m.calls, 0);
    const tokens = models.reduce((sum, m) => sum + m.input + m.output, 0);
    $("usage-calls").textContent = compact(calls);
    $("usage-models-count").textContent = String(models.length);
    $("usage-tokens").textContent = compact(tokens);

    // Share of answers per family: few, stable colors, labelled with their percentage.
    const families = Object.keys(FAMILIES)
      .map((family) => ({ family, calls: models.filter((m) => m.family === family).reduce((s, m) => s + m.calls, 0) }))
      .filter((f) => f.calls > 0);
    const pct = (n) => (calls ? Math.round((n / calls) * 100) : 0);
    $("usage-share").replaceChildren(
      ...families.map((f) =>
        Object.assign(document.createElement("div"), {
          className: "h-full first:rounded-l-full last:rounded-r-full",
          style: `flex:${f.calls} 1 0;min-width:4px;background:${familyColor(f.family)}`,
          title: `${FAMILIES[f.family].name} : ${plural(f.calls, "réponse")} (${pct(f.calls)} %)`,
        }),
      ),
    );
    $("usage-legend").innerHTML = families
      .map(
        (f) => `<span class="flex items-center gap-1.5">
          <span class="size-2.5 rounded-sm" style="background:${familyColor(f.family)}"></span>
          <span class="font-medium">${FAMILIES[f.family].name}</span>
          <span class="tabular-nums text-zinc-500 dark:text-zinc-400">${pct(f.calls)} %</span>
        </span>`,
      )
      .join("");

    renderModels(models, calls);
    renderLimits(data.limits ?? []);
  }

  function renderModels(models, total) {
    const list = $("usage-models");
    if (models.length === 0) {
      list.innerHTML = `<li class="py-4 text-center text-xs text-zinc-400">Aucune IA utilisée sur cette période.</li>`;
      return;
    }
    const sparkDays = Array.from({ length: SPARK_DAYS }, (_, i) => localDay(SPARK_DAYS - 1 - i));
    // Activity over the last 14 days, from all rows (not just the selected range).
    const recent = summarize(data.rows, sparkDays[0]);
    list.innerHTML = models
      .map((m) => {
        const color = familyColor(m.family);
        const days = recent.find((r) => r.key === m.key)?.days ?? new Map();
        const peak = Math.max(1, ...sparkDays.map((d) => days.get(d) ?? 0));
        const bars = sparkDays
          .map((d) => {
            const n = days.get(d) ?? 0;
            const label = `${lastUsed(d)} : ${plural(n, "réponse")}`;
            return n
              ? `<i style="height:${Math.max(12, Math.round((n / peak) * 100))}%;background:${color}" title="${esc(label)}"></i>`
              : `<i class="empty" title="${esc(label)}"></i>`;
          })
          .join("");
        const share = total ? Math.round((m.calls / total) * 100) : 0;
        return `<li class="flex items-center gap-3 py-2.5">
          <span class="size-2.5 shrink-0 rounded-full" style="background:${color}"></span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-1.5">
              <span class="truncate text-sm font-semibold">${esc(m.name)}</span>
              <span class="shrink-0 rounded bg-zinc-100 px-1.5 py-px text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">${esc(m.tool)}</span>
            </div>
            <p class="text-xs text-zinc-600 dark:text-zinc-300">
              <span class="font-semibold tabular-nums">${plural(m.calls, "réponse")}</span>
              <span class="text-zinc-400">· ${share} %</span>
            </p>
            <p class="truncate text-[11px] text-zinc-400" title="Tokens lus (contexte, cache compris) · tokens écrits">
              ${compact(m.input)} lus · ${compact(m.output)} écrits · ${lastUsed(m.lastDay)}
            </p>
          </div>
          <div class="activity shrink-0" aria-label="Activité sur 14 jours">${bars}</div>
        </li>`;
      })
      .join("");
  }

  function renderLimits(limits) {
    $("usage-limits-block").classList.toggle("hidden", limits.length === 0);
    const now = Date.now();
    $("usage-limits").innerHTML = limits
      .sort((a, b) => a.windowMinutes - b.windowMinutes)
      .map((l) => {
        const reset = l.resetsAt && l.resetsAt > now;
        const used = reset ? Math.min(100, Math.round(l.usedPercent)) : 0; // window over: back to zero
        const window = l.windowMinutes >= 1440 ? "semaine" : `${Math.round(l.windowMinutes / 60)} h`;
        const status = used >= 90 ? "⛔ presque tout utilisé" : used >= 70 ? "⚠️ attention" : "";
        const bar = used >= 90 ? "bg-rose-500" : used >= 70 ? "bg-amber-500" : "bg-emerald-500";
        return `<div>
          <div class="flex items-baseline justify-between gap-2 text-xs">
            <span><span class="font-semibold">${esc(l.tool)}</span> · limite ${window} ${status ? `<span class="text-zinc-500 dark:text-zinc-400">${status}</span>` : ""}</span>
            <span class="font-semibold tabular-nums">${used} %</span>
          </div>
          <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div class="h-full rounded-full ${bar}" style="width:${used}%"></div>
          </div>
          <p class="mt-0.5 text-[11px] text-zinc-400">${reset ? `Se recharge dans ${timeLeft(l.resetsAt - now)}` : "Rechargée depuis ta dernière session"}</p>
        </div>`;
      })
      .join("");
  }

  return {
    async refresh() {
      if (loading) return;
      loading = true;
      render();
      try {
        data = (await call("model_usage", { tzOffsetMinutes: new Date().getTimezoneOffset() })) ?? data;
      } catch {
        // keep what we had
      } finally {
        loading = false;
      }
      data ??= { rows: [], limits: [] };
      render();
    },
  };
}

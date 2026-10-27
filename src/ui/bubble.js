import { State } from "../core/states.js";
import { EtaEstimator } from "../core/eta.js";
import { approx, duration } from "../core/format.js";
import { compact, describeModel } from "../core/models.js";

/** A compaction usually takes about this long when we haven't seen one on this PC yet. */
const DEFAULT_COMPACT_MS = 75_000;
/** Context fuller than this: the next compaction is close. */
const CONTEXT_WARN = 0.8;

/**
 * Status bubble under the mascot:
 *   ● Claudio · Claude Code       Total 42%
 *   « Ajoute le mode sombre »
 *   Étape 2/5 · Écrit les tests          70%
 *   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔ (step)
 *   ▸ Modifie pet.js
 *   ⏱ 1 min 20 · reste ≈ 2 min · 12 actions · 3 fichiers
 *   🧠 Contexte ▓▓▓░░ 64 %          (Claude Code)
 *   ▓▓▓▓▓▓░░░░░░ (total)
 * While the context is being compacted, the step row becomes « 🧹 Compactage » with
 * its own progress, based on how long compactions usually take.
 */
export function createBubble(el) {
  el.className =
    "pointer-events-none mt-1 w-[224px] rounded-2xl bg-white/95 dark:bg-zinc-900/95 px-3 py-1.5 shadow-md ring-1 ring-black/5 dark:ring-white/10 " +
    "transition duration-300 opacity-0 translate-y-1";
  el.innerHTML = `
    <div class="flex items-center gap-1.5 text-[11px] leading-4">
      <span data-dot class="size-2 shrink-0 rounded-full"></span>
      <span data-title class="truncate font-semibold text-zinc-800 dark:text-zinc-100"></span>
      <span class="ml-auto shrink-0 tabular-nums text-zinc-700 dark:text-zinc-200">
        <span data-total-label class="text-[10px] font-normal text-zinc-400">Total</span>
        <span data-pct class="font-semibold"></span>
      </span>
    </div>
    <div data-prompt class="truncate pl-3.5 text-[11px] italic leading-4 text-zinc-400"></div>
    <div data-step class="pl-3.5">
      <div class="flex items-center gap-1 text-[10px] leading-4">
        <span data-step-name class="truncate text-zinc-600 dark:text-zinc-300"></span>
        <span data-step-pct class="ml-auto shrink-0 font-semibold tabular-nums text-zinc-600 dark:text-zinc-300"></span>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div data-step-bar class="h-full rounded-full opacity-60 transition-[width] duration-500"></div>
      </div>
    </div>
    <div data-label class="truncate pl-3.5 text-[11px] font-medium leading-4 text-zinc-600 dark:text-zinc-300"></div>
    <div data-meta class="truncate pl-3.5 text-[10px] leading-4 text-zinc-400"></div>
    <div data-context class="flex items-center gap-1.5 pl-3.5 text-[10px] leading-4 text-zinc-400">
      <span class="shrink-0">🧠 Contexte</span>
      <div class="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div data-context-bar class="h-full rounded-full transition-[width] duration-500"></div>
      </div>
      <span data-context-pct class="shrink-0 tabular-nums"></span>
    </div>
    <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
      <div data-bar class="h-full rounded-full transition-[width] duration-500"></div>
    </div>`;

  const $ = (name) => el.querySelector(`[data-${name}]`);
  const ui = Object.fromEntries(
    ["dot", "title", "total-label", "pct", "prompt", "step", "step-name", "step-pct", "step-bar", "label", "meta", "context", "context-bar", "context-pct", "bar"].map(
      (name) => [name, $(name)],
    ),
  );

  const eta = new EtaEstimator();

  return {
    /** @param context { tokens, window, model, compactMs } of a Claude Code session, if known */
    render(session, context = null) {
      const visible = Boolean(session && session.state !== State.IDLE);
      el.classList.toggle("hidden", !visible);
      el.classList.toggle("opacity-0", !visible);
      el.classList.toggle("translate-y-1", !visible);
      if (!visible) return;

      const d = session.details ?? {};
      const done = session.state === State.DONE;
      const compacting = session.state === State.COMPACTING ? d.compact : null;
      const compactMs = context?.compactMs ?? DEFAULT_COMPACT_MS;
      const compactPct = compacting ? Math.min(95, Math.round(((Date.now() - compacting.startedAt) / compactMs) * 100)) : 0;
      // A /compact on its own: the compaction *is* the task.
      const onlyCompacting = Boolean(compacting && d.compactOnly);
      const known = onlyCompacting || typeof session.progress === "number";
      const total = onlyCompacting ? compactPct : Math.round((session.progress ?? 0) * 100);

      ui.dot.style.background = session.color;
      ui.bar.style.background = session.color;
      ui["step-bar"].style.background = session.color;
      const model = d.model ?? context?.model;
      const agentLabel = model ? `${session.agent} · ${describeModel(model).name}` : session.agent;
      ui.title.textContent = session.headline ?? [session.project, agentLabel].filter(Boolean).join(" · ");
      ui.pct.textContent = done ? "✨" : known ? `${total}%` : session.tokens ? `${session.tokens} tok` : "";
      ui["total-label"].classList.toggle("hidden", done || !known || !d.step);

      ui.prompt.textContent = d.prompt ? `« ${d.prompt} »` : "";
      ui.prompt.classList.toggle("hidden", !d.prompt);

      const step = !done && !compacting ? d.step : null;
      ui.step.classList.toggle("hidden", !step && !(compacting && !onlyCompacting));
      if (compacting && !onlyCompacting) {
        ui["step-name"].textContent = "🧹 Compactage du contexte (auto)";
        ui["step-pct"].textContent = `${compactPct}%`;
        ui["step-bar"].style.width = `${compactPct}%`;
      } else if (step) {
        const stepPct = Math.round(step.progress * 100);
        ui["step-name"].textContent = `Étape ${step.index}/${step.count}${step.name ? ` · ${step.name}` : ""}`;
        ui["step-pct"].textContent = `${stepPct}%`;
        ui["step-bar"].style.width = `${stepPct}%`;
      }

      ui.label.textContent = compacting ? "🧹 Compacte le contexte…" : (done ? "" : "▸ ") + session.label;

      const elapsed = d.startedAt ? Date.now() - d.startedAt : 0;
      const left = compacting
        ? Math.max(0, compacting.startedAt + compactMs - Date.now())
        : done ? null : eta.remaining(session);
      const facts = [
        !done && elapsed ? `⏱ ${duration(elapsed)}` : "",
        left === null ? "" : left < 5000 ? "presque fini…" : `reste ${approx(left)}`,
        d.steps ? `${d.steps} action${d.steps > 1 ? "s" : ""}` : "",
        d.files ? `${d.files} fichier${d.files > 1 ? "s" : ""}` : "",
        d.subagents ? `${d.subagents} sous-agent${d.subagents > 1 ? "s" : ""}` : "",
        d.errors ? `⚠ ${d.errors} échec${d.errors > 1 ? "s" : ""}` : "",
      ].filter(Boolean);
      ui.meta.textContent = facts.join(" · ");
      ui.meta.classList.toggle("hidden", facts.length === 0);

      const fill = context?.tokens && !compacting && !done ? Math.min(1, context.tokens / context.window) : null;
      ui.context.classList.toggle("hidden", fill === null);
      if (fill !== null) {
        const warn = fill >= CONTEXT_WARN;
        ui["context-bar"].style.width = `${Math.round(fill * 100)}%`;
        ui["context-bar"].style.background = warn ? "#f59e0b" : "#a1a1aa";
        ui["context-pct"].textContent = `${Math.round(fill * 100)} %${warn ? " · compactage bientôt" : ""}`;
        ui.context.title = `${compact(context.tokens)} tokens sur ${compact(context.window)}`;
      }

      ui.bar.classList.toggle("bar-indeterminate", !known);
      ui.bar.style.width = known ? `${total}%` : "";
    },
  };
}

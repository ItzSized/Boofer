import { State } from "../core/states.js";
import { duration } from "../core/format.js";

/**
 * Status bubble under the mascot:
 *   ● Claudio · Claude Code            42%
 *   « Ajoute le mode sombre »
 *   ▸ Modifie pet.js
 *   ⏱ 1 min 20 · 12 actions · 3 fichiers · tâche 2/5
 *   ▓▓▓▓▓▓░░░░░░
 */
export function createBubble(el) {
  el.className =
    "pointer-events-none mt-1 w-[224px] rounded-2xl bg-white/95 px-3 py-1.5 shadow-md ring-1 ring-black/5 " +
    "transition duration-300 opacity-0 translate-y-1";
  el.innerHTML = `
    <div class="flex items-center gap-1.5 text-[11px] leading-4">
      <span data-dot class="size-2 shrink-0 rounded-full"></span>
      <span data-title class="truncate font-semibold text-zinc-800"></span>
      <span data-pct class="ml-auto shrink-0 font-semibold tabular-nums text-zinc-700"></span>
    </div>
    <div data-prompt class="truncate pl-3.5 text-[11px] italic leading-4 text-zinc-400"></div>
    <div data-label class="truncate pl-3.5 text-[11px] font-medium leading-4 text-zinc-600"></div>
    <div data-meta class="truncate pl-3.5 text-[10px] leading-4 text-zinc-400"></div>
    <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200">
      <div data-bar class="h-full rounded-full transition-[width] duration-500"></div>
    </div>`;

  const $ = (name) => el.querySelector(`[data-${name}]`);
  const [dot, title, prompt, label, meta, pct, bar] = ["dot", "title", "prompt", "label", "meta", "pct", "bar"].map($);

  return {
    render(session) {
      const visible = session && session.state !== State.IDLE;
      el.classList.toggle("opacity-0", !visible);
      el.classList.toggle("translate-y-1", !visible);
      if (!visible) return;

      const d = session.details ?? {};
      const done = session.state === State.DONE;
      dot.style.background = session.color;
      bar.style.background = session.color;
      title.textContent = session.headline ?? [session.project, session.agent].filter(Boolean).join(" · ");
      prompt.textContent = d.prompt ? `« ${d.prompt} »` : "";
      prompt.classList.toggle("hidden", !d.prompt);
      label.textContent = (done ? "" : "▸ ") + (d.taskName && !done ? `${d.taskName} — ${session.label}` : session.label);

      const facts = [
        !done && d.startedAt ? `⏱ ${duration(Date.now() - d.startedAt)}` : "",
        d.steps ? `${d.steps} action${d.steps > 1 ? "s" : ""}` : "",
        d.files ? `${d.files} fichier${d.files > 1 ? "s" : ""} modifié${d.files > 1 ? "s" : ""}` : "",
        d.task && !done ? `tâche ${d.task}` : "",
        d.subagents ? `${d.subagents} sous-agent${d.subagents > 1 ? "s" : ""}` : "",
        d.errors ? `⚠ ${d.errors} échec${d.errors > 1 ? "s" : ""}` : "",
      ].filter(Boolean);
      meta.textContent = facts.join(" · ");
      meta.classList.toggle("hidden", facts.length === 0);

      const known = typeof session.progress === "number";
      const percent = Math.round((session.progress ?? 0) * 100);
      bar.classList.toggle("bar-indeterminate", !known);
      bar.style.width = known ? `${percent}%` : "";
      pct.textContent = done ? "✨" : known ? `${percent}%` : session.tokens ? `${session.tokens} tok` : "";
    },
  };
}

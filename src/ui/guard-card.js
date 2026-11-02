/**
 * « 🛑 Stop ! Es-tu sûr de continuer ? »: Claude Code is about to run a dangerous command
 * (src-tauri/src/guard.rs decided). Nothing runs until the user picks; no answer in time
 * means blocked. Requests queue up; the card shows the oldest one.
 *
 * `resolve(id, allow)` answers Claude Code's PreToolUse hook.
 */
const TIMEOUT_MS = 55_000; // same as guard.rs

export function createGuardCard(el, { agentName, resolve, onChange }) {
  el.id = "guard-card";
  el.className =
    "mt-1 hidden w-[224px] flex-col rounded-2xl bg-white dark:bg-zinc-900 px-3 py-2 text-[11px] leading-4 shadow-lg ring-2 ring-rose-500/70";
  el.innerHTML = `
    <div class="flex items-center gap-1.5">
      <span class="text-sm leading-none">🛑</span>
      <span class="font-bold text-rose-600 dark:text-rose-400">Stop ! Es-tu sûr de continuer ?</span>
      <span data-count class="ml-auto shrink-0 rounded-full bg-rose-100 dark:bg-rose-900/60 px-1.5 text-[10px] text-rose-600 dark:text-rose-300"></span>
    </div>
    <div class="mt-1 text-zinc-600 dark:text-zinc-300"><span data-who class="font-semibold"></span> va <strong data-danger class="text-zinc-800 dark:text-zinc-100"></strong>.</div>
    <div data-why class="mt-0.5 italic text-zinc-400"></div>
    <div data-detail class="mt-1 max-h-[42px] overflow-hidden break-all rounded-lg bg-rose-50 dark:bg-rose-950/40 px-2 py-1 font-mono text-[10px] text-zinc-700 dark:text-zinc-200"></div>
    <div class="mt-2 grid grid-cols-2 gap-1">
      <button data-block class="rounded-lg bg-rose-500 py-1 font-semibold text-white hover:bg-rose-600">✋ Bloquer</button>
      <button data-allow class="rounded-lg bg-zinc-100 dark:bg-zinc-800 py-1 font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700">Continuer</button>
    </div>
    <div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div data-timer class="guard-timer h-full rounded-full bg-rose-400"></div>
    </div>
    <div data-timer-text class="mt-0.5 text-center text-[10px] text-zinc-400"></div>`;

  const $ = (name) => el.querySelector(`[data-${name}]`);
  const queue = [];
  let ticker = null;

  function tick() {
    const current = queue[0];
    if (!current) return;
    const left = Math.max(0, TIMEOUT_MS - (Date.now() - current.at));
    $("timer").style.width = `${(left / TIMEOUT_MS) * 100}%`;
    $("timer-text").textContent = `Sans réponse, bloqué dans ${Math.ceil(left / 1000)} s`;
  }

  function render() {
    const current = queue[0];
    el.classList.toggle("hidden", !current);
    el.classList.toggle("flex", Boolean(current));
    onChange(Boolean(current));
    clearInterval(ticker);
    if (!current) return;

    const p = current.payload;
    const project = p.cwd ? p.cwd.split(/[\\/]/).filter(Boolean).pop() : "";
    $("who").textContent = [agentName, project].filter(Boolean).join(" · ");
    $("danger").textContent = current.danger;
    $("why").textContent = p.tool_input?.description ? `« ${p.tool_input.description} »` : "";
    $("detail").textContent = p.tool_input?.command ?? "";
    $("count").textContent = queue.length > 1 ? `+${queue.length - 1}` : "";
    tick();
    ticker = setInterval(tick, 1000);
  }

  function answer(allow) {
    const current = queue.shift();
    if (current) resolve(current.id, allow);
    render();
  }

  $("block").addEventListener("click", () => answer(false));
  $("allow").addEventListener("click", () => answer(true));

  return {
    el,
    isOpen: () => queue.length > 0,
    add(request) {
      queue.push({ ...request, at: Date.now() });
      render();
    },
    /** Boofer stopped waiting: the command was blocked. */
    expire(id) {
      const i = queue.findIndex((r) => r.id === id);
      if (i < 0) return;
      queue.splice(i, 1);
      render();
    },
  };
}

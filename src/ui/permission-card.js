/**
 * "Claude Code wants to run…  [Autoriser] [Toujours] [Refuser]"
 * Requests queue up; the card shows the oldest one.
 *
 * `resolve(id, decision)` sends Claude Code's `decision` object back,
 * or null to let Claude Code show its own prompt.
 */
export function createPermissionCard(el, { agentName, color, resolve, onChange }) {
  el.className =
    "mt-1 hidden w-[224px] flex-col rounded-2xl bg-white dark:bg-zinc-900 px-3 py-2 text-[11px] leading-4 shadow-lg ring-1 ring-black/10 dark:ring-white/15";
  el.innerHTML = `
    <div class="flex items-center gap-1.5">
      <span class="size-2 shrink-0 rounded-full" style="background:${color}"></span>
      <span data-title class="truncate font-semibold text-zinc-800 dark:text-zinc-100"></span>
      <span data-count class="ml-auto shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 text-[10px] text-zinc-500 dark:text-zinc-400"></span>
    </div>
    <div data-what class="mt-0.5 text-zinc-500 dark:text-zinc-400"></div>
    <div data-detail class="mt-1 max-h-[42px] overflow-hidden break-all rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-700 dark:text-zinc-200"></div>
    <div data-buttons class="mt-2 grid gap-1">
      <button data-allow class="rounded-lg bg-emerald-500 py-1 font-semibold text-white hover:bg-emerald-600">Autoriser</button>
      <button data-always title="Autoriser et ne plus demander pour ça" class="rounded-lg bg-emerald-100 dark:bg-emerald-900/60 py-1 font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900">Toujours</button>
      <button data-deny class="rounded-lg bg-rose-100 dark:bg-rose-900/50 py-1 font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900">Refuser</button>
    </div>
    <button data-skip class="mt-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">Répondre dans Claude Code</button>`;

  const $ = (name) => el.querySelector(`[data-${name}]`);
  const queue = [];

  function render() {
    const current = queue[0];
    el.classList.toggle("hidden", !current);
    el.classList.toggle("flex", Boolean(current));
    onChange(Boolean(current));
    if (!current) return;

    const p = current.payload;
    const [what, detail] = describe(p);
    const project = p.cwd ? p.cwd.split(/[\\/]/).filter(Boolean).pop() : "";
    $("title").textContent = [agentName, project].filter(Boolean).join(" · ");
    $("count").textContent = queue.length > 1 ? `+${queue.length - 1}` : "";
    $("what").textContent = what;
    $("detail").textContent = detail;

    const canAlways = Array.isArray(p.permission_suggestions) && p.permission_suggestions.length > 0;
    $("always").classList.toggle("hidden", !canAlways);
    $("buttons").style.gridTemplateColumns = `repeat(${canAlways ? 3 : 2}, minmax(0, 1fr))`;
  }

  function answer(decision) {
    const current = queue.shift();
    if (current) resolve(current.id, decision);
    render();
  }

  $("allow").addEventListener("click", () => answer({ behavior: "allow" }));
  $("always").addEventListener("click", () =>
    answer({ behavior: "allow", updatedPermissions: queue[0]?.payload.permission_suggestions }),
  );
  $("deny").addEventListener("click", () =>
    answer({ behavior: "deny", message: "Refusé par l'utilisateur depuis Booffer." }),
  );
  $("skip").addEventListener("click", () => answer(null));

  const drop = (predicate) => {
    const before = queue.length;
    for (let i = queue.length - 1; i >= 0; i--) if (predicate(queue[i])) queue.splice(i, 1);
    if (queue.length !== before) render();
  };

  return {
    el,
    isOpen: () => queue.length > 0,
    add(request) {
      queue.push(request);
      render();
    },
    /** Booffer gave up waiting (Claude Code now asks by itself). */
    expire: (id) => drop((r) => r.id === id),
    /** The user answered in Claude Code instead: the session moved on. */
    dismissSession(sessionId) {
      queue.filter((r) => r.payload.session_id === sessionId).forEach((r) => resolve(r.id, null));
      drop((r) => r.payload.session_id === sessionId);
    },
  };
}

function describe(p) {
  const input = p.tool_input ?? {};
  switch (p.tool_name) {
    case "Bash":
    case "PowerShell":
      return [input.description ? `veut lancer : ${input.description}` : "veut lancer une commande :", input.command ?? ""];
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return ["veut modifier un fichier :", input.file_path ?? input.notebook_path ?? ""];
    case "WebFetch":
      return ["veut ouvrir une page :", input.url ?? ""];
    case "WebSearch":
      return ["veut chercher sur le web :", input.query ?? ""];
    default: {
      const tool = p.tool_name?.startsWith("mcp__") ? p.tool_name.split("__").slice(1).join(" › ") : p.tool_name;
      return [`veut utiliser ${tool} :`, JSON.stringify(input).slice(0, 200)];
    }
  }
}

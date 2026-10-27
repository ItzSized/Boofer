import { ACTIVE_STATES, State } from "../core/states.js";

/** A tiny ghost per session, in its color. */
const MINI_GHOST = `<svg viewBox="18 12 84 100" class="mini-ghost size-3.5 shrink-0" aria-hidden="true">
  <path d="M20 62 C20 32 38 14 60 14 C82 14 100 32 100 62 V106 q-6.67 10 -13.33 0 t-13.33 0 t-13.33 0 t-13.33 0 t-13.33 0 t-13.35 0 Z" />
  <ellipse cx="47" cy="62" rx="6" ry="8" fill="#2b2240" /><ellipse cx="73" cy="62" rx="6" ry="8" fill="#2b2240" />
</svg>`;

/** One little ghost per session, shown when two or more agents are running. Click to switch. */
export function createTabs(el, { onSelect }) {
  el.className = "mt-1 hidden w-[232px] flex-wrap justify-center gap-1";

  el.addEventListener("click", (e) => {
    const key = e.target.closest("button")?.dataset.key;
    if (key) onSelect(key);
  });

  return {
    el,
    isOpen: () => el.classList.contains("flex"),
    render(sessions, selectedKey) {
      const show = sessions.length >= 2;
      el.classList.toggle("hidden", !show);
      el.classList.toggle("flex", show);
      if (!show) return;

      el.replaceChildren(
        ...sessions.map((s) => {
          const button = document.createElement("button");
          button.dataset.key = s.key;
          const selected = s.key === selectedKey;
          button.className =
            "flex max-w-[112px] items-center gap-1 rounded-full bg-white/95 dark:bg-zinc-900/95 px-2 py-0.5 text-[10px] leading-4 shadow-sm " +
            (selected ? "font-semibold text-zinc-800 dark:text-zinc-100 ring-2 ring-zinc-700 dark:ring-zinc-200" : "text-zinc-500 dark:text-zinc-400 ring-1 ring-black/10 dark:ring-white/15 hover:text-zinc-800 dark:hover:text-zinc-100");

          const dot = document.createElement("span");
          dot.className = `flex ${ACTIVE_STATES.has(s.state) ? "mini-busy" : ""}`;
          dot.innerHTML = MINI_GHOST;
          dot.style.fill = s.state === State.IDLE ? "#d4d4d8" : s.color;

          const name = document.createElement("span");
          name.className = "truncate";
          name.textContent = s.project || s.agent;

          const status = document.createElement("span");
          status.className = "shrink-0 tabular-nums";
          status.textContent = statusText(s);

          button.append(dot, name, status);
          return button;
        }),
      );
    },
  };
}

function statusText(s) {
  switch (s.state) {
    case State.DONE:
      return "✓";
    case State.ATTENTION:
      return "!";
    case State.ERROR:
      return "⚠";
    case State.IDLE:
      return "";
    default:
      return typeof s.progress === "number" ? `${Math.round(s.progress * 100)}%` : "…";
  }
}

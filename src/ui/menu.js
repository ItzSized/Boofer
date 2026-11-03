/**
 * Right-click menu. `label` can be a function so toggles show their current value, and
 * `visible` a function to show an item only when it applies. `{ heading }` titles a group (left
 * out when none of its items shows) and `{ separator: true }` draws a line.
 * Hidden: the window is frameless and skips the taskbar, so this + the tray is how you quit.
 * `onToggle` runs when it opens or closes (the window must then catch clicks there, or not).
 */
export function createMenu(el, items, { onToggle = () => {} } = {}) {
  el.className =
    "absolute top-2 hidden max-h-[calc(100vh-1rem)] min-w-36 flex-col overflow-y-auto rounded-xl bg-white/95 dark:bg-zinc-900/95 py-1 text-xs shadow-lg ring-1 ring-black/10 dark:ring-white/15";

  const render = () => {
    const shown = (item) => !item.heading && !item.separator && (!item.visible || item.visible());
    el.innerHTML = items
      .map((item, i) => {
        if (item.separator) return `<div class="my-1 border-t border-zinc-200 dark:border-zinc-700"></div>`;
        if (item.heading) {
          const next = items.slice(i + 1);
          const end = next.findIndex((x) => x.heading || x.separator);
          if (!(end === -1 ? next : next.slice(0, end)).some(shown)) return "";
          return `<p class="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">${item.heading}</p>`;
        }
        if (!shown(item)) return "";
        const label = typeof item.label === "function" ? item.label() : item.label;
        return `<button data-i="${i}" class="px-3 py-1.5 text-left text-zinc-700 dark:text-zinc-200 hover:bg-violet-100 dark:hover:bg-violet-900/50">${label}</button>`;
      })
      .join("");
  };

  const hide = () => el.classList.replace("flex", "hidden") && onToggle();
  el.addEventListener("click", (e) => {
    const i = e.target.closest("button")?.dataset.i;
    hide();
    if (i !== undefined) items[i].action();
  });
  window.addEventListener("blur", hide);
  document.addEventListener("pointerdown", (e) => !el.contains(e.target) && hide());

  return {
    el,
    isOpen: () => el.classList.contains("flex"),
    show() {
      render();
      el.classList.replace("hidden", "flex");
      onToggle();
    },
  };
}

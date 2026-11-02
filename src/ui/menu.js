/**
 * Right-click menu. `label` can be a function so toggles show their current value, and
 * `visible` a function to show an item only when it applies.
 * Hidden: the window is frameless and skips the taskbar, so this + the tray is how you quit.
 * `onToggle` runs when it opens or closes (the window must then catch clicks there, or not).
 */
export function createMenu(el, items, { onToggle = () => {} } = {}) {
  el.className =
    "absolute top-2 hidden min-w-36 flex-col overflow-hidden rounded-xl bg-white/95 dark:bg-zinc-900/95 py-1 text-xs shadow-lg ring-1 ring-black/10 dark:ring-white/15";

  const render = () => {
    el.innerHTML = items
      .map((item, i) => {
        if (item.visible && !item.visible()) return "";
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

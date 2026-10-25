/**
 * Right-click menu. `label` can be a function so toggles show their current value.
 * Hidden: the window is frameless and skips the taskbar, so this + the tray is how you quit.
 */
export function createMenu(el, items) {
  el.className =
    "absolute top-2 hidden min-w-36 flex-col overflow-hidden rounded-xl bg-white/95 py-1 text-xs shadow-lg ring-1 ring-black/10";

  const render = () => {
    el.innerHTML = items
      .map((item, i) => {
        const label = typeof item.label === "function" ? item.label() : item.label;
        return `<button data-i="${i}" class="px-3 py-1.5 text-left text-zinc-700 hover:bg-violet-100">${label}</button>`;
      })
      .join("");
  };

  const hide = () => el.classList.replace("flex", "hidden");
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
    },
  };
}

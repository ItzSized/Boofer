import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { playPat } from "../audio/chime.js";

const SLEEP_AFTER_MS = 45_000;
const TRICKS = [
  ["trick-spin", 1100],
  ["trick-hop", 900],
  ["trick-peek", 1600],
];
const HEART = `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3.2 4.5 7 4.5c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.8 0 6.1 3.9 4.6 7.3C19.5 16.4 12 21 12 21z"/></svg>`;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const inside = (p, r, pad = 0) =>
  r.width > 0 && p.x >= r.left - pad && p.x <= r.right + pad && p.y >= r.top - pad && p.y <= r.bottom + pad;

/**
 * Everything that makes the ghost feel alive: eyes that follow the cursor,
 * hover/pat reactions, sleep, idle tricks, and window click-through.
 */
export function createPet({ app, mascot, mascotEl, closeBtn, fx, targets, isTauri, onClose, onWindowTitle }) {
  const win = isTauri ? getCurrentWindow() : null;
  const body = () => mascotEl.querySelector(".body").getBoundingClientRect();
  const isIdle = () => mascotEl.dataset.state === "idle";

  let ignoring = null;
  let visible = true;
  let moving = false;
  let lastMoveAt = Date.now();
  let last = { x: -1, y: -1 };

  // Transparent pixels still catch clicks on Windows: let them through
  // unless the cursor is over the ghost, the close button, the menu or the permission card.
  function setIgnore(value) {
    if (!win || value === ignoring) return;
    ignoring = value;
    win.setIgnoreCursorEvents(value);
  }

  let title = null;
  function onTick(t) {
    if (t.title !== undefined && t.title !== title) {
      title = t.title;
      onWindowTitle?.(title);
    }
    visible = t.visible;
    moving = t.moving;
    app.classList.toggle("away", !visible);

    const b = body();
    const dx = t.x - (b.left + b.width / 2);
    const dy = t.y - (b.top + b.height * 0.47);
    const d = Math.hypot(dx, dy) || 1;
    // Up to 2.6 SVG units: keeps the highlight inside the eye.
    const reach = Math.min(2.6, d / 30) / d;
    mascotEl.style.setProperty("--look-x", `${(dx * reach).toFixed(2)}px`);
    mascotEl.style.setProperty("--look-y", `${(dy * reach).toFixed(2)}px`);

    mascotEl.classList.toggle("moving", moving);
    mascotEl.style.setProperty("--tilt", `${clamp(t.vx * 2, -14, 14)}deg`);

    const wasHovering = app.classList.contains("hovering");
    const hovering = visible && (inside(t, b, 8) || (wasHovering && inside(t, closeBtn.getBoundingClientRect(), 6)));
    app.classList.toggle("hovering", hovering);
    setIgnore(!(hovering || targets().some((el) => inside(t, el.getBoundingClientRect(), 4))));

    if (Math.abs(t.x - last.x) + Math.abs(t.y - last.y) > 3) {
      lastMoveAt = Date.now();
      wake();
    }
    last = t;
  }

  function wake() {
    if (!mascotEl.classList.contains("sleeping")) return;
    mascotEl.classList.remove("sleeping");
    mascot.flash("waking", 700);
  }

  setInterval(() => {
    if (isIdle() && visible && Date.now() - lastMoveAt > SLEEP_AFTER_MS) mascotEl.classList.add("sleeping");
    if (!isIdle()) wake();
  }, 1000);

  (function scheduleTrick() {
    setTimeout(() => {
      const busy = !isIdle() || moving || !visible || mascotEl.classList.contains("sleeping");
      if (!busy && !app.classList.contains("hovering")) {
        const [cls, ms] = TRICKS[Math.floor(Math.random() * TRICKS.length)];
        mascot.flash(cls, ms);
      }
      scheduleTrick();
    }, 7000 + Math.random() * 8000);
  })();

  function pat() {
    lastMoveAt = Date.now();
    wake();
    mascot.flash("patted", 900);
    playPat();
    const b = body();
    for (let i = 0; i < 3; i++) {
      const heart = document.createElement("div");
      heart.className = "heart";
      heart.innerHTML = HEART;
      heart.style.left = `${b.left + b.width * (0.3 + Math.random() * 0.4)}px`;
      heart.style.top = `${b.top + 4}px`;
      heart.style.setProperty("--dx", `${(Math.random() - 0.5) * 50}px`);
      heart.style.animationDelay = `${i * 110}ms`;
      fx.append(heart);
      setTimeout(() => heart.remove(), 1500);
    }
  }

  // A click is a pat; a click-and-move is a drag.
  let press = null;
  mascotEl.addEventListener("pointerdown", (e) => {
    if (e.button === 0) press = { x: e.screenX, y: e.screenY };
  });
  mascotEl.addEventListener("pointermove", (e) => {
    if (press && Math.hypot(e.screenX - press.x, e.screenY - press.y) > 4) {
      press = null;
      win?.startDragging();
    }
  });
  window.addEventListener("pointerup", () => {
    if (press) pat();
    press = null;
  });

  closeBtn.addEventListener("click", onClose);

  if (isTauri) {
    listen("pet-tick", ({ payload }) => onTick(payload));
  } else {
    // Plain browser (npm run dev): fake the ticks from regular mouse events.
    window.addEventListener("mousemove", (e) => onTick({ x: e.clientX, y: e.clientY, visible: true, moving: false, vx: 0 }));
  }
}

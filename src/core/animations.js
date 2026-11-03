// Animation groups the user can switch off (settings → Animations). Each group is a class
// on <html> (`anim-off-<id>`) that style.css uses to stop the matching CSS animations.
export const ANIMATION_GROUPS = [
  { id: "float", name: "🫧 Floats", hint: "drifts gently up and down when idle" },
  { id: "work", name: "⚙️ Busy at work", hint: "swaying, thinking dots, compacting" },
  { id: "arms", name: "👋 Arms", hint: "swings its arms, waves, claps" },
  { id: "celebrate", name: "🎉 Victory jump", hint: "jump and sparkles when a task is done" },
  { id: "tricks", name: "🌀 Spins and cuddles", hint: "spins when idle, hearts when you pet it" },
  { id: "blink", name: "👀 Blinks", hint: "blinks and glances" },
  { id: "sleep", name: "💤 Zzz", hint: "the Zs and breathing while it sleeps" },
];

/** Applies `settings.animationsOff` (["arms", …] or ["all"]) to the page. */
export function applyAnimations(off = []) {
  const all = off.includes("all");
  const root = document.documentElement;
  root.classList.toggle("anim-off-all", all);
  for (const { id } of ANIMATION_GROUPS) root.classList.toggle(`anim-off-${id}`, all || off.includes(id));
}

/** True when the group is off, for animations driven from JS (tricks, hearts). */
export const animationOff = (id) =>
  document.documentElement.classList.contains("anim-off-all") || document.documentElement.classList.contains(`anim-off-${id}`);

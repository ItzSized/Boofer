// Animation groups the user can switch off (settings → Animations). Each group is a class
// on <html> (`anim-off-<id>`) that style.css uses to stop the matching CSS animations.
export const ANIMATION_GROUPS = [
  { id: "float", name: "🫧 Flotte", hint: "il monte et descend doucement au repos" },
  { id: "work", name: "⚙️ S'agite au travail", hint: "balancement, points de réflexion, compactage" },
  { id: "arms", name: "👋 Bras", hint: "balance les bras, fait coucou, applaudit" },
  { id: "celebrate", name: "🎉 Saut de fin", hint: "saut et étincelles quand une tâche finit" },
  { id: "tricks", name: "🌀 Pirouettes et câlins", hint: "pirouettes au repos, cœurs quand tu le caresses" },
  { id: "blink", name: "👀 Cligne des yeux", hint: "clignements et coups d'œil" },
  { id: "sleep", name: "💤 Zzz", hint: "les Z et la respiration quand il dort" },
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

/**
 * The ghost grows with you: every finished task is 1 XP. Levels get further apart,
 * and some unlock a look (see .mascot[data-level] in style.css).
 * Kept in localStorage, shared by the ghost and settings windows.
 */
import { loadHistory } from "./history.js";

const KEY = "booffer.xp";

/** [level, total XP needed, title] */
const LEVELS = [
  [1, 0, "Little ghost"],
  [2, 3, "Curious ghost"],
  [3, 10, "Prankster spirit"],
  [4, 25, "Tinkering specter"],
  [5, 50, "Expert revenant"],
  [6, 100, "Spirit of code"],
  [7, 200, "Great specter"],
  [8, 400, "Legendary ghost"],
];

/** What each level unlocks, shown in the settings. */
export const PERKS = {
  3: "a soft glow",
  5: "a golden halo",
  8: "a golden aura",
};

export function loadXp() {
  try {
    const stored = localStorage.getItem(KEY);
    // First run with levels: count the tasks already in the history.
    return stored === null ? loadHistory().length : Number(stored) || 0;
  } catch {
    return 0;
  }
}

/** @returns the new level if this XP made the ghost level up, else null */
export function gainXp(amount = 1) {
  const before = levelFor(loadXp());
  const xp = loadXp() + amount;
  try {
    localStorage.setItem(KEY, String(xp));
  } catch {
    // nice-to-have
  }
  const after = levelFor(xp);
  return after.level > before.level ? after : null;
}

export function levelFor(xp) {
  let index = 0;
  while (index + 1 < LEVELS.length && xp >= LEVELS[index + 1][1]) index++;
  const [level, from, title] = LEVELS[index];
  const next = LEVELS[index + 1];
  return {
    level,
    title,
    xp,
    from,
    to: next ? next[1] : null,
    progress: next ? (xp - from) / (next[1] - from) : 1,
  };
}

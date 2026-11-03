/**
 * Daily token limit per AI (settings → 📊 Models) and the pace: are you ahead or behind?
 *
 * Pace = how much of the limit you should have used by now if you spread it evenly over
 * the working day (8 am → midnight). "20% ahead" means you're burning it faster
 * than that: at this rate the limit runs out before the evening.
 * For plan limits with a reset time (Codex 5 h / weekly), the pace is the share of the
 * window already gone.
 */
import { FAMILIES, describeModel, localDay } from "./models.js";

const DAY_START_H = 8;
const DAY_END_H = 24;
/** Within ±5 points of the pace = "on pace". */
const ON_PACE = 5;

/** Share of today's working day already gone, 0 → 1. */
export function dayElapsed(now = new Date()) {
  const hours = now.getHours() + now.getMinutes() / 60;
  return Math.min(1, Math.max(0, (hours - DAY_START_H) / (DAY_END_H - DAY_START_H)));
}

/**
 * @param rows usage rows from `model_usage`
 * @param limits { anthropic: 50_000_000, … } daily tokens; missing or 0 = no limit
 * @returns one entry per family with a limit: { family, name, used, limit, pct, delta }
 */
export function dailyBudgets(rows, limits, now = new Date()) {
  const today = localDay(0);
  const used = new Map();
  for (const row of rows ?? []) {
    if (row.day !== today) continue;
    const { family } = describeModel(row.model);
    used.set(family, (used.get(family) ?? 0) + row.input + row.output);
  }
  const elapsed = dayElapsed(now);
  return Object.entries(limits ?? {})
    .filter(([family, limit]) => limit > 0 && FAMILIES[family])
    .map(([family, limit]) => {
      const tokens = used.get(family) ?? 0;
      const pct = tokens / limit;
      return { family, name: FAMILIES[family].name, used: tokens, limit, pct, delta: Math.round((pct - elapsed) * 100) };
    });
}

/** Tokens per day of this family over the 7 days before today (days without use count as 0). */
export function dailyAverage(rows, family) {
  const from = localDay(7);
  const today = localDay(0);
  const total = (rows ?? [])
    .filter((r) => r.day >= from && r.day < today && describeModel(r.model).family === family)
    .reduce((sum, r) => sum + r.input + r.output, 0);
  return Math.round(total / 7);
}

/** { anthropic: 100 } (% of the average) → { anthropic: 68_800_000 } (tokens) for dailyBudgets. */
export function limitsFromPercent(rows, percents) {
  const limits = {};
  for (const [family, pct] of Object.entries(percents ?? {})) {
    const average = dailyAverage(rows, family);
    if (pct > 0 && average > 0) limits[family] = Math.round((average * pct) / 100);
  }
  return limits;
}

/** Plan limit with a reset time → how far ahead of its window it is, in points. */
export function windowDelta(limit, now = Date.now()) {
  if (!(limit.resetsAt > now) || !limit.windowMinutes) return null;
  const windowMs = limit.windowMinutes * 60_000;
  const elapsed = 1 - (limit.resetsAt - now) / windowMs;
  return Math.round(limit.usedPercent - Math.min(1, Math.max(0, elapsed)) * 100);
}

/** "⚡ 18% ahead" / "🐢 12% behind" / "✓ on pace". */
export function paceLabel(delta) {
  if (delta === null || delta === undefined) return null;
  if (delta > ON_PACE) return { text: `⚡ ${delta}% ahead`, tone: "ahead" };
  if (delta < -ON_PACE) return { text: `🐢 ${-delta}% behind`, tone: "behind" };
  return { text: "✓ on pace", tone: "even" };
}

export const PACE_HELP =
  "Ahead = you are using it faster than your limit allows (spread from 8 am to midnight). Behind = you will have some left.";

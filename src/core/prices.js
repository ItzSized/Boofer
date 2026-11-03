/**
 * What the tokens would cost at API prices, in dollars — rough: most people pay a subscription,
 * so this is "what it's worth", not a bill. $ per million tokens, read / written.
 * Claude Code's "read" tokens are mostly cache reads (≈ 10% of the normal price), so
 * Anthropic's read prices below are the cache prices.
 */
import { describeModel } from "./models.js";

const PRICES = [
  // [family, word in the model name, $ / M read, $ / M written]
  ["anthropic", "haiku", 0.1, 5],
  ["anthropic", "sonnet", 0.3, 15],
  ["anthropic", "", 1.5, 75], // Opus and others
  ["google", "flash", 0.3, 2.5],
  ["google", "", 1.25, 10], // Pro and others
  ["openai", "mini", 0.25, 2],
  ["openai", "", 1.25, 10],
  ["other", "", 1, 5],
];

/** $ for tokens of a model, by its family and shown name (as in `summarize`). */
export function costOf(family, name, input, output) {
  const lower = String(name).toLowerCase();
  const [, , read, written] = PRICES.find(([f, word]) => f === family && lower.includes(word)) ?? PRICES.at(-1);
  return (input * read + output * written) / 1e6;
}

/** $ for one usage row (model, input, output). */
export function rowCost(row) {
  const { name, family } = describeModel(row.model);
  return costOf(family, name, row.input, row.output);
}

/** "≈ $12", "≈ $0.40", "< $0.01" */
export function dollars(value) {
  if (value < 0.01) return "< $0.01";
  return `≈ $${value.toLocaleString("en-US", { maximumFractionDigits: value < 10 ? 2 : 0 })}`;
}

/**
 * Raw model ids from each tool → a name people recognize, and the family it
 * belongs to (its color everywhere in Booffer).
 *   claude-opus-5-5 → Claude Opus 5.5 · gemini-pro-default → Gemini Pro · gpt-6-astra → GPT-6 Astra
 */

/** Fixed order: a family keeps its color whatever the others do (validated palette, light & dark). */
export const FAMILIES = {
  anthropic: { name: "Claude", light: "#D97757", dark: "#D4704F" },
  google: { name: "Gemini", light: "#4285F4", dark: "#4285F4" },
  openai: { name: "GPT / Codex", light: "#10A37F", dark: "#10A37F" },
  other: { name: "Autres", light: "#8B5CF6", dark: "#8B5CF6" },
};

export function familyColor(family) {
  const dark = document.documentElement.dataset.theme === "dark";
  const f = FAMILIES[family] ?? FAMILIES.other;
  return dark ? f.dark : f.light;
}

const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/** @returns {{ name: string, family: keyof FAMILIES }} */
export function describeModel(raw) {
  const id = String(raw ?? "").trim();
  const lower = id.toLowerCase();

  if (!id || lower.startsWith("model_placeholder")) return { name: "Modèle auto", family: "other" };

  // claude-opus-5-5, claude-sonnet-4-5-20250929, claude-opus-4-6-thinking, claude-fable-5-1[1m]
  const claude = lower.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(-thinking)?(\[1m\])?$/);
  if (claude) {
    const [, tier, major, minor, thinking] = claude;
    return { name: `Claude ${cap(tier)} ${major}${minor ? `.${minor}` : ""}${thinking ? " (Thinking)" : ""}`, family: "anthropic" };
  }
  if (/^(claude|opus|sonnet|haiku|fable)\b/.test(lower)) return { name: id.replace(/^claude/i, "Claude"), family: "anthropic" };

  if (lower.startsWith("gemini")) {
    // gemini-3.8-flash-n, gemini-pro-default, Gemini 4 Argon (f3.8), gemini-3.1-pro-preview
    const name = id
      .replace(/\s*\(f[\d.]+\)$/i, "")
      .replace(/-(default|preview|[a-z])$/i, (m) => (m === "-preview" ? " (preview)" : ""))
      .split(/[-\s]+/)
      .map((part) => (/^\d/.test(part) ? part : cap(part)))
      .join(" ");
    return { name, family: "google" };
  }

  if (lower === "codex-auto-review") return { name: "Codex · revue auto", family: "openai" };
  // gpt-6-astra, gpt-5.6-sol, o3, codex-mini
  const gpt = lower.match(/^gpt-([\d.]+)(?:-(.+))?$/);
  if (gpt) return { name: `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].split("-").map(cap).join(" ")}` : ""}`, family: "openai" };
  if (/^(o\d|codex)/.test(lower)) return { name: id.split("-").map(cap).join(" "), family: "openai" };

  return { name: id, family: "other" };
}

/** 1 234 → « 1,2 k » · 1 755 113 192 → « 1,8 Md » */
export function compact(n) {
  if (!n) return "0";
  const units = [
    [1e9, "Md"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [size, unit] of units) {
    if (n >= size) {
      const v = n / size;
      return `${v.toFixed(v >= 100 ? 0 : 1).replace(/\.0$/, "").replace(".", ",")} ${unit}`;
    }
  }
  return String(n);
}

/** Local "YYYY-MM-DD", `daysAgo` days back. */
export function localDay(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Usage rows (tool, model, day, calls, input, output) → one entry per model and tool,
 * since `fromDay` (inclusive, "" = everything). Most used first.
 */
export function summarize(rows, fromDay = "") {
  const byModel = new Map();
  for (const row of rows ?? []) {
    if (fromDay && row.day < fromDay) continue;
    const { name, family } = describeModel(row.model);
    const key = `${row.tool}::${name}`;
    const m = byModel.get(key) ?? { key, tool: row.tool, name, family, calls: 0, input: 0, output: 0, lastDay: "", days: new Map() };
    m.calls += row.calls;
    m.input += row.input;
    m.output += row.output;
    if (row.day > m.lastDay) m.lastDay = row.day;
    m.days.set(row.day, (m.days.get(row.day) ?? 0) + row.calls);
    byModel.set(key, m);
  }
  return [...byModel.values()].sort((a, b) => b.calls - a.calls);
}

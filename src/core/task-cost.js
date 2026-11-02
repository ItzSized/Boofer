/**
 * What a task cost: tokens from the user's request to « fini », and the share of the
 * daily limit (settings → 📊 Modèles) they represent. Counted like the limits: input + output.
 *
 * - Claude Code: exact, from its transcript (src-tauri/src/session_stats.rs), subagents included.
 * - AI chats in the browser: the estimate made for that answer (details.webUsage).
 * - Codex, Antigravity: the tool's tokens today at the end minus at the start of the task
 *   (two sessions of the same tool at once share their count).
 */
import { compact, describeModel, localDay } from "./models.js";

/** Tokens of `tool` today in usage rows. */
export function toolTotal(rows, tool) {
  const today = localDay(0);
  return (rows ?? []).filter((r) => r.tool === tool && r.day === today).reduce((sum, r) => sum + r.input + r.output, 0);
}

/**
 * @param tokens tokens of the task
 * @param model the model's id or name, for its family's daily limit
 * @param limits { anthropic: 68_800_000, … } from limitsFromPercent
 */
export function describeCost(tokens, model, limits) {
  if (!(tokens > 0)) return null;
  const limit = model ? limits?.[describeModel(model).family] : null;
  const pct = limit ? tokens / limit : null;
  const pctText = pct === null ? "" : ` · ${pct < 0.01 ? "< 1" : Math.round(pct * 100)} % de ta limite du jour`;
  return { tokens, pct, label: `💰 ${compact(tokens)} tokens${pctText}` };
}

/** Names of the context parts sent by `claude_session_stats`, with their color. */
export const CONTEXT_PARTS = {
  system: ["⚙️ Système et instructions", "#a1a1aa"],
  prompts: ["💬 Tes messages", "#8b5cf6"],
  replies: ["🤖 Réponses de l'IA", "#3b82f6"],
  toolCalls: ["🛠️ Appels d'outils", "#06b6d4"],
  files: ["📄 Fichiers lus", "#f59e0b"],
  commands: ["⌨️ Commandes", "#10b981"],
  search: ["🔎 Recherches et web", "#ec4899"],
  otherTools: ["🧩 Autres outils", "#64748b"],
  summary: ["🧹 Résumé du compactage", "#c084fc"],
};

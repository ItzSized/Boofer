import { AgentAdapter } from "./base-adapter.js";
import { compact } from "../core/models.js";
import { duration } from "../core/format.js";
import { State } from "../core/states.js";

/** The sites src-tauri/src/web.rs recognizes, with their color in Boofer. */
export const WEB_SITES = [
  { id: "chatgpt", name: "ChatGPT", color: "#10A37F" },
  { id: "gemini", name: "Gemini", color: "#4285F4" },
  { id: "aistudio", name: "AI Studio", color: "#4285F4" },
  { id: "claude", name: "Claude", color: "#D97757" },
  { id: "grok", name: "Grok", color: "#6366F1" },
  { id: "perplexity", name: "Perplexity", color: "#20808D" },
  { id: "deepseek", name: "DeepSeek", color: "#4D6BFE" },
  { id: "mistral", name: "Le Chat", color: "#FA520F" },
  { id: "copilot", name: "Copilot", color: "#0078D4" },
];

/** "2.5 Pro" on Gemini → "Gemini 2.5 Pro", so the model lands in the right family. */
function modelName(shown, site) {
  if (!shown) return site;
  return /gemini|gpt|claude|grok|deepseek|mistral|copilot|perplexity|sonar/i.test(shown) ? shown : `${site} ${shown}`;
}

const truncate = (text, n) => (text && text.length > n ? `${text.slice(0, n - 1)}…` : text ?? "");

/**
 * An AI chat in the browser, read by src-tauri/src/web.rs (no extension needed):
 * "agent-event" web-<site> { id (window), kind: start | progress | done | closed, title, tookMs }
 */
export class WebAdapter extends AgentAdapter {
  #turns = new Map(); // tab → { startedAt, prompt, model }

  constructor({ id, name, color }) {
    super();
    Object.assign(this, { source: `web-${id}`, name, color, site: id });
  }

  normalize(p) {
    const id = p?.id;
    if (!id) return null;
    if (p.kind === "closed") {
      this.#turns.delete(id);
      return { id, state: State.IDLE }; // no label: the session ends
    }
    const project = truncate(p.title, 40);
    let turn = this.#turns.get(id);
    if (p.kind === "start" || !turn) {
      turn = { startedAt: Date.now(), prompt: truncate(p.prompt, 80), model: modelName(p.model, this.name) };
      this.#turns.set(id, turn);
    }
    if (p.model) turn.model = modelName(p.model, this.name);
    const details = { prompt: turn.prompt || undefined, startedAt: turn.startedAt, model: turn.model };

    switch (p.kind) {
      case "start":
        return { id, project, state: State.THINKING, label: "Thinking…", details };
      case "progress":
        return {
          id,
          project,
          state: State.STREAMING,
          label: p.chars ? `Writing the answer · ${compact(p.chars)} characters` : "Writing the answer…",
          details,
        };
      case "done": {
        this.#turns.delete(id);
        // Rough token counts (≈ 4 characters each) for "📊 Models" and the daily limits.
        const usage = { site: this.site, tool: this.name, model: turn.model, input: Math.round((p.promptChars ?? 0) / 4), output: Math.round((p.chars ?? 0) / 4) };
        return {
          id,
          project,
          state: State.DONE,
          headline: `${this.name} answered!`,
          label: `Answered in ${duration(p.tookMs || Date.now() - turn.startedAt)}`,
          details: { ...details, webUsage: usage },
        };
      }
      default:
        return null;
    }
  }
}

import { AgentAdapter } from "./base-adapter.js";
import { State } from "../core/states.js";

const VALID_STATES = new Set(Object.values(State));

/**
 * For anything that already speaks Booffer's format, e.g. reporters/anthropic.js:
 * POST /event/<source> { id, state, label?, progress?, tokens?, project?, headline? }
 */
export class GenericAdapter extends AgentAdapter {
  constructor({ source, name, color }) {
    super();
    Object.assign(this, { source, name, color });
  }

  normalize(p) {
    if (!p || !VALID_STATES.has(p.state)) return null;
    const progress = typeof p.progress === "number" ? Math.min(Math.max(p.progress, 0), 1) : null;
    return { id: p.id, state: p.state, label: p.label, progress, tokens: p.tokens ?? null, project: p.project, headline: p.headline, details: p.details ?? null };
  }
}

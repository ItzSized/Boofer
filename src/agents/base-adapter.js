import { State } from "../core/states.js";

const DEFAULT_LABELS = {
  [State.THINKING]: "Réfléchit…",
  [State.TOOL]: "Travaille…",
  [State.STREAMING]: "Écrit…",
  [State.ATTENTION]: "A besoin de toi !",
  [State.DONE]: "Terminé !",
  [State.ERROR]: "Oups, erreur",
};

/**
 * Contract for an agent integration. To support a new agent:
 *  1. subclass this, set `source` (the URL segment: POST /event/<source>)
 *  2. implement `normalize(payload)` → { id, state, label?, progress?, tokens? } | null
 *  3. register it in agents/index.js
 */
export class AgentAdapter {
  /** @type {string} */ source;
  /** @type {string} */ name;
  /** @type {string} */ color = "#a78bfa";

  /** Return null to ignore an event. */
  normalize(_payload) {
    throw new Error(`${this.constructor.name} must implement normalize()`);
  }

  defaultLabel(state) {
    return DEFAULT_LABELS[state] ?? "";
  }
}

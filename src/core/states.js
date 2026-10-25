/**
 * Normalized states every adapter must map to.
 * The mascot only knows these, never anything agent-specific.
 */
export const State = Object.freeze({
  IDLE: "idle",
  THINKING: "thinking", // request sent, waiting for the first token
  TOOL: "tool", // agent is running a tool (bash, edit, search…)
  STREAMING: "streaming", // tokens are arriving
  ATTENTION: "attention", // agent waits for the user (permission, question)
  DONE: "done",
  ERROR: "error",
});

/** Higher wins when several sessions run at once. */
export const PRIORITY = {
  [State.ATTENTION]: 6,
  [State.ERROR]: 5,
  [State.DONE]: 4,
  [State.TOOL]: 3,
  [State.STREAMING]: 3,
  [State.THINKING]: 2,
  [State.IDLE]: 0,
};

export const ACTIVE_STATES = new Set([State.THINKING, State.TOOL, State.STREAMING]);

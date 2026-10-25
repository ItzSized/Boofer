import { ClaudeCodeAdapter } from "./claude-code.js";
import { GenericAdapter } from "./generic.js";

/** Add new agents here — the rest of the app picks them up automatically. */
export const adapters = [
  new ClaudeCodeAdapter(),
  new GenericAdapter({ source: "claude-api", name: "Claude", color: "#D97757" }),
  new GenericAdapter({ source: "generic", name: "Agent", color: "#a78bfa" }),
];

export const adapterBySource = new Map(adapters.map((a) => [a.source, a]));

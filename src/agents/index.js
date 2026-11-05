import { AntigravityAdapter } from "./antigravity.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { GenericAdapter } from "./generic.js";
import { TerminalAdapter } from "./terminal.js";
import { WEB_SITES, WebAdapter } from "./web.js";

/** Add new agents here — the rest of the app picks them up automatically. */
export const adapters = [
  new AntigravityAdapter(),
  new ClaudeCodeAdapter(),
  new CodexAdapter(),
  new GenericAdapter({ source: "claude-api", name: "Claude", color: "#D97757" }),
  new GenericAdapter({ source: "generic", name: "Agent", color: "#a78bfa" }),
  // ChatGPT, Gemini, Claude, Grok… in the browser (src-tauri/src/web.rs).
  ...WEB_SITES.map((site) => new WebAdapter(site)),
  // GitHub Copilot's chat in VS Code, read from VS Code's chat files (src-tauri/src/vscode.rs).
  new WebAdapter({ id: "vscode", name: "Copilot", color: "#8957E5" }),
  // A long command in a terminal: its own % and pace (src-tauri/src/terminal.rs).
  new TerminalAdapter(),
];

export const adapterBySource = new Map(adapters.map((a) => [a.source, a]));

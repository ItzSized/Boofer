import { AgentAdapter } from "./base-adapter.js";
import { duration } from "../core/format.js";
import { State } from "../core/states.js";

const truncate = (text, n) => (text && text.length > n ? `${text.slice(0, n - 1)}…` : text ?? "");

/**
 * A long command in a terminal (a download, sfc /scannow…), read by src-tauri/src/terminal.rs:
 * "agent-event" terminal { id (window), kind: start | progress | done | closed, title, line,
 * percent (0…1), etaMs (at its own pace), startedMs }
 */
export class TerminalAdapter extends AgentAdapter {
  source = "terminal";
  name = "Terminal";
  color = "#22c55e";
  #turns = new Map(); // window → { startedAt, line }

  normalize(p) {
    const id = p?.id;
    if (!id) return null;
    if (p.kind === "closed") {
      this.#turns.delete(id);
      return { id, state: State.IDLE }; // no label: the session ends
    }
    let turn = this.#turns.get(id);
    if (p.kind === "start" || !turn) {
      turn = { startedAt: p.startedMs ?? Date.now(), line: "" };
      this.#turns.set(id, turn);
    }
    if (p.line) turn.line = truncate(p.line, 80);
    const project = truncate(p.title, 40) || "Terminal";
    const percent = typeof p.percent === "number" ? Math.min(Math.max(p.percent, 0), 1) : null;
    const details = {
      startedAt: turn.startedAt,
      prompt: turn.line || undefined,
      percent: percent ?? undefined,
      // core/eta.js counts down from the command's own estimate between two readings.
      etaMs: typeof p.etaMs === "number" ? p.etaMs : undefined,
      etaAt: Date.now(),
    };
    if (p.kind === "done") {
      this.#turns.delete(id);
      return {
        id,
        project,
        state: State.DONE,
        headline: "Command finished!",
        label: `Finished in ${duration(Date.now() - turn.startedAt)}`,
        details: { startedAt: turn.startedAt, prompt: turn.line || undefined },
      };
    }
    return {
      id,
      project,
      state: State.TOOL,
      label: percent === null ? "Running…" : `${Math.round(percent * 100)}% done`,
      progress: percent,
      details,
    };
  }
}

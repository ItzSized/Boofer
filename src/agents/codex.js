import { AgentAdapter } from "./base-adapter.js";
import { duration } from "../core/format.js";
import { State } from "../core/states.js";

const STEP_SCALE = 12;
const MAX_ESTIMATE = 0.9;

/**
 * Codex → src-tauri/src/codex.rs reads its session files live and sends one event
 * per step: { session_id, project, model, kind: start | prompt | thinking | tool | compacted | done | aborted }.
 * Scripts can also POST the generic shape ({ id, state, label, progress }) to /event/codex.
 */
export class CodexAdapter extends AgentAdapter {
  source = "codex";
  name = "Codex";
  color = "#10A37F";

  #turns = new Map();

  normalize(p) {
    if (!p) return null;
    if (Object.values(State).includes(p.state)) {
      return { id: p.id ?? "default", state: p.state, label: p.label, progress: p.progress ?? null, project: p.project ?? "" };
    }
    const id = p.session_id;
    // Codex's automatic safety reviews run as their own sessions: not the user's work.
    if (!id || /auto-review/.test(p.model ?? "")) return null;
    const out = (turn, rest) => ({ id, project: p.project ?? "", details: this.#details(turn, p.model), ...rest });

    switch (p.kind) {
      case "start": {
        const turn = this.#newTurn(id);
        return out(turn, { state: State.THINKING, label: turn.label, progress: turn.progress });
      }
      case "prompt": {
        const turn = this.#turn(id);
        turn.prompt = truncate(p.text, 80);
        return out(turn, { state: State.THINKING, label: turn.label, progress: turn.progress });
      }
      case "thinking": {
        const turn = this.#turn(id);
        return out(turn, { state: State.THINKING, label: "Réfléchit…", progress: this.#progress(turn) });
      }
      case "tool": {
        const turn = this.#turn(id);
        turn.steps++;
        turn.label = describe(p.name, p.input ?? "", turn);
        return out(turn, { state: State.TOOL, label: turn.label, progress: this.#progress(turn) });
      }
      case "compacted": {
        const turn = this.#turn(id);
        return out(turn, { state: State.THINKING, label: "Contexte compacté, reprend…", progress: this.#progress(turn) });
      }
      case "done":
      case "aborted": {
        const turn = this.#turn(id);
        this.#turns.delete(id);
        const took = duration(Date.now() - turn.startedAt);
        if (p.kind === "aborted") return out(turn, { state: State.DONE, headline: "Codex s'est arrêté", label: `Interrompu après ${took}` });
        return out(turn, { state: State.DONE, headline: `${p.project || this.name} a fini !`, label: `Terminé en ${took}` });
      }
      default:
        return null;
    }
  }

  #newTurn(id) {
    const turn = { startedAt: Date.now(), prompt: "", steps: 0, files: new Set(), progress: 0.03, label: "Réfléchit…" };
    this.#turns.set(id, turn);
    return turn;
  }

  #turn(id) {
    return this.#turns.get(id) ?? this.#newTurn(id);
  }

  #progress(turn) {
    const value = MAX_ESTIMATE * (1 - Math.exp(-turn.steps / STEP_SCALE));
    turn.progress = Math.min(0.97, Math.max(turn.progress, value));
    return turn.progress;
  }

  #details(turn, model) {
    return {
      prompt: turn.prompt,
      model: model || null,
      startedAt: turn.startedAt,
      steps: turn.steps,
      files: turn.files.size,
      errors: 0,
      subagents: 0,
      step: null,
    };
  }
}

/** Codex tools: `exec` runs JS calling tools.exec_command / tools.apply_patch / tools.web__run… */
function describe(name, input, turn) {
  const tool = input.match(/tools\.(\w+)/)?.[1] ?? name;
  const file = input.match(/\*\*\* (?:Update|Add) File: (.+)/)?.[1];
  if (file) turn.files.add(file.trim());
  switch (tool) {
    case "apply_patch":
      return file ? `Modifie ${basename(file)}` : "Modifie des fichiers";
    case "exec_command":
    case "shell":
    case "local_shell": {
      const cmd = input.match(/cmd\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? input.match(/"command"\s*:\s*\[?"([^"]*)/)?.[1];
      return cmd ? `Lance : ${truncate(cmd.replace(/\\\\/g, "\\"), 34)}` : "Lance une commande";
    }
    case "web__run":
    case "web_search":
      return "Cherche sur le web";
    case "view_image":
      return "Regarde une image";
    default:
      return tool ? `Utilise ${tool.replace(/__/g, " ")}` : "Travaille…";
  }
}

function basename(path) {
  return path ? path.split(/[\\/]/).filter(Boolean).pop() : "";
}

function truncate(text, max = 40) {
  const line = String(text ?? "").split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

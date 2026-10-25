import { AgentAdapter } from "./base-adapter.js";
import { duration } from "../core/format.js";
import { State } from "../core/states.js";

/** Steps after which the estimated progress reaches ~63% (when Claude keeps no todo list). */
const STEP_SCALE = 15;
const MAX_ESTIMATE = 0.9;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * Claude Code → hooks (see hooks/claude-code-settings.example.json) send their
 * JSON input to POST /event/claude-code. One session per `session_id`.
 *
 * Progress: the real ratio of completed todos when Claude keeps a todo list
 * (TodoWrite), otherwise an estimate from the number of tool calls this turn.
 */
export class ClaudeCodeAdapter extends AgentAdapter {
  source = "claude-code";
  name = "Claude Code";
  color = "#D97757";

  #turns = new Map();

  normalize(p) {
    const id = p?.session_id;
    if (!id) return null;
    const project = basename(p.cwd);
    const out = (turn, rest) => ({ id, project, details: this.#details(turn), ...rest });

    switch (p.hook_event_name) {
      case "UserPromptSubmit": {
        const turn = this.#newTurn(id, p.prompt);
        return out(turn, { state: State.THINKING, label: turn.label, progress: turn.progress });
      }
      case "PreToolUse": {
        const turn = this.#turn(id);
        turn.steps++;
        if (p.tool_name === "TodoWrite" && Array.isArray(p.tool_input?.todos)) turn.todos = p.tool_input.todos;
        const file = p.tool_input?.file_path ?? p.tool_input?.notebook_path;
        if (EDIT_TOOLS.has(p.tool_name) && file) turn.files.add(file);
        turn.label = this.#describe(p.tool_name, p.tool_input ?? {}, turn);
        return out(turn, { state: State.TOOL, label: turn.label, progress: this.#progress(turn) });
      }
      case "PostToolUse": {
        const turn = this.#turn(id);
        return out(turn, { state: State.THINKING, label: turn.label, progress: this.#progress(turn) });
      }
      case "PostToolUseFailure": {
        const turn = this.#turn(id);
        turn.errors++;
        return out(turn, { state: State.THINKING, label: `Échec : ${turn.label}`, progress: this.#progress(turn) });
      }
      case "SubagentStart":
      case "SubagentStop": {
        const turn = this.#turn(id);
        turn.subagents = Math.max(0, turn.subagents + (p.hook_event_name === "SubagentStart" ? 1 : -1));
        return out(turn, { state: State.THINKING, label: turn.label, progress: this.#progress(turn) });
      }
      case "Notification": {
        // "Waiting for your input" arrives a minute after Stop: not worth a ping.
        if (p.notification_type === "idle_prompt" || /waiting for your input/i.test(p.message ?? "")) return null;
        return out(this.#turn(id), { state: State.ATTENTION, label: "A besoin de toi !" });
      }
      case "Stop": {
        const turn = this.#turn(id);
        this.#turns.delete(id);
        return out(turn, {
          state: State.DONE,
          headline: `${project || this.name} a fini !`,
          label: `Terminé en ${duration(Date.now() - turn.startedAt)}`,
        });
      }
      case "SessionEnd":
        this.#turns.delete(id);
        return { id, state: State.IDLE };
      default:
        return null;
    }
  }

  #newTurn(id, prompt) {
    const turn = {
      startedAt: Date.now(),
      prompt: prompt ? truncate(prompt, 80) : "",
      steps: 0,
      todos: null,
      files: new Set(),
      errors: 0,
      subagents: 0,
      progress: 0.03,
      label: "Réfléchit…",
    };
    this.#turns.set(id, turn);
    return turn;
  }

  // A turn may already be running when Booffer starts: create it lazily.
  #turn(id) {
    return this.#turns.get(id) ?? this.#newTurn(id, "");
  }

  #details(turn) {
    const todos = turn.todos ?? [];
    const done = todos.filter((t) => t.status === "completed").length;
    const current = todos.find((t) => t.status === "in_progress");
    return {
      prompt: turn.prompt,
      startedAt: turn.startedAt,
      steps: turn.steps,
      files: turn.files.size,
      errors: turn.errors,
      subagents: turn.subagents,
      task: todos.length ? `${Math.min(done + 1, todos.length)}/${todos.length}` : "",
      taskName: current ? truncate(current.activeForm ?? current.content, 60) : "",
    };
  }

  #progress(turn) {
    let value;
    if (turn.todos?.length) {
      const done = turn.todos.filter((t) => t.status === "completed").length;
      const doing = turn.todos.filter((t) => t.status === "in_progress").length;
      value = (done + doing * 0.5) / turn.todos.length;
    } else {
      value = MAX_ESTIMATE * (1 - Math.exp(-turn.steps / STEP_SCALE));
    }
    // Never go backwards within a turn, never claim 100% before Stop.
    turn.progress = Math.min(0.97, Math.max(turn.progress, value));
    return turn.progress;
  }

  #describe(tool, input, turn) {
    const file = basename(input.file_path ?? input.notebook_path);
    switch (tool) {
      case "Edit":
      case "MultiEdit":
      case "NotebookEdit":
        return `Modifie ${file}`;
      case "Write":
        return `Écrit ${file}`;
      case "Read":
        return `Lit ${file}`;
      case "Bash":
      case "PowerShell":
        return input.description ? truncate(input.description) : `Lance : ${truncate(input.command ?? "")}`;
      case "Grep":
      case "Glob":
        return `Cherche « ${truncate(input.pattern ?? "", 24)} »`;
      case "WebSearch":
        return `Cherche : ${truncate(input.query ?? "", 30)}`;
      case "WebFetch":
        return `Lit ${hostname(input.url)}`;
      case "Agent":
      case "Task":
        return `Délègue : ${truncate(input.description ?? "sous-agent")}`;
      case "TodoWrite": {
        const current = turn.todos?.find((t) => t.status === "in_progress");
        return current ? truncate(current.activeForm ?? current.content) : "Planifie les tâches";
      }
      default:
        if (tool?.startsWith("mcp__")) return `Utilise ${tool.split("__")[1]}`;
        return tool ? `Utilise ${tool}` : "Travaille…";
    }
  }
}

function basename(path) {
  return path ? path.split(/[\\/]/).filter(Boolean).pop() : "";
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "une page web";
  }
}

function truncate(text, max = 40) {
  const line = String(text).split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}


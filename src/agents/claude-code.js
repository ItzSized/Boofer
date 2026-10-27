import { AgentAdapter } from "./base-adapter.js";
import { duration } from "../core/format.js";
import { State } from "../core/states.js";

/** Actions after which the estimated progress reaches ~63% (when Claude keeps no todo list). */
const STEP_SCALE = 15;
/** Same, for one task of Claude's todo list. */
const TASK_SCALE = 6;
const MAX_ESTIMATE = 0.9;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

/**
 * Claude Code → hooks (see hooks/claude-code-settings.example.json) send their
 * JSON input to POST /event/claude-code. One session per `session_id`.
 *
 * Progress, when Claude keeps a todo list (TodoWrite): total = (completed tasks
 * + estimated progress of the current task) / tasks; the current task's progress
 * is estimated from the actions since it started. Without a list: an estimate
 * from the number of actions this turn.
 *
 * Compaction: PreCompact → "compacting" until SessionStart (source "compact"),
 * or until tools run again.
 * A /compact typed by the user ends as "done"; an automatic one mid-task goes back to work.
 */
export class ClaudeCodeAdapter extends AgentAdapter {
  source = "claude-code";
  name = "Claude Code";
  color = "#D97757";

  #turns = new Map();

  normalize(p) {
    const id = p?.session_id;
    const project = basename(p?.cwd);
    // Booffer's own prompt compression (settings → ✂️ Tokens) runs Claude there.
    if (!id || project === "booffer-compress") return null;
    const out = (turn, rest) => ({ id, project, details: this.#details(turn), ...rest });

    switch (p.hook_event_name) {
      case "UserPromptSubmit": {
        const turn = this.#newTurn(id, p.prompt);
        return out(turn, { state: State.THINKING, label: turn.label, progress: turn.progress });
      }
      case "PreToolUse": {
        const turn = this.#turn(id);
        turn.compact = null; // an automatic compaction is over once tools run again
        turn.steps++;
        if (p.tool_name === "TodoWrite" && Array.isArray(p.tool_input?.todos)) {
          turn.todos = p.tool_input.todos;
          this.#trackTask(turn);
        }
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
      case "PreCompact": {
        const turn = this.#turn(id);
        // /compact typed by the user (it may come with its own UserPromptSubmit): never mid-task.
        if (p.trigger !== "auto") turn.compactOnly = true;
        turn.compact = { startedAt: Date.now(), trigger: p.trigger === "auto" ? "auto" : "manual" };
        return out(turn, { state: State.COMPACTING, label: "Compacte le contexte…", progress: turn.progress });
      }
      case "SessionStart": {
        const turn = this.#turns.get(id);
        if (p.source !== "compact" || !turn?.compact) return null;
        const took = duration(Date.now() - turn.compact.startedAt);
        turn.compact = null;
        if (turn.compactOnly) {
          this.#turns.delete(id);
          return out(turn, { state: State.DONE, headline: "Contexte compacté !", label: `Compacté en ${took}` });
        }
        turn.label = `Contexte compacté en ${took}, reprend…`;
        return out(turn, { state: State.THINKING, label: turn.label, progress: this.#progress(turn) });
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
      task: null, // { key, startSteps, startedAt } of the in-progress todo
    };
    this.#turns.set(id, turn);
    return turn;
  }

  // A turn may already be running when Booffer starts: create it lazily.
  #turn(id) {
    return this.#turns.get(id) ?? this.#newTurn(id, "");
  }

  #trackTask(turn) {
    const current = turn.todos.find((t) => t.status === "in_progress");
    const key = current ? (current.content ?? current.activeForm) : null;
    if (key !== turn.task?.key) turn.task = key ? { key, startSteps: turn.steps, startedAt: Date.now() } : null;
  }

  #taskProgress(turn) {
    if (!turn.task) return 0;
    return Math.min(0.95, 1 - Math.exp(-(turn.steps - turn.task.startSteps) / TASK_SCALE));
  }

  #details(turn) {
    const todos = turn.todos ?? [];
    const done = todos.filter((t) => t.status === "completed").length;
    const current = todos.find((t) => t.status === "in_progress");
    return {
      prompt: turn.prompt,
      startedAt: turn.startedAt,
      compact: turn.compact ?? null,
      compactOnly: Boolean(turn.compactOnly),
      steps: turn.steps,
      files: turn.files.size,
      errors: turn.errors,
      subagents: turn.subagents,
      step: todos.length
        ? {
            index: Math.min(done + 1, todos.length),
            count: todos.length,
            name: current ? truncate(current.activeForm ?? current.content, 60) : "",
            progress: this.#taskProgress(turn),
            startedAt: turn.task?.startedAt ?? null,
          }
        : null,
    };
  }

  #progress(turn) {
    let value;
    if (turn.todos?.length) {
      const done = turn.todos.filter((t) => t.status === "completed").length;
      value = (done + this.#taskProgress(turn)) / turn.todos.length;
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


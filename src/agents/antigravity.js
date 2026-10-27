import { AgentAdapter } from "./base-adapter.js";
import { duration } from "../core/format.js";
import { State } from "../core/states.js";

const STEP_SCALE = 14;
const MAX_ESTIMATE = 0.92;
const VALID_STATES = new Set(Object.values(State));
const EDIT_TOOLS = new Set([
  "edit_file",
  "multi_edit",
  "write_file",
  "replace_file_content",
  "multi_replace_file_content",
  "write_to_file",
]);

/**
 * Antigravity IDE / Antigravity 2.0 adapter.
 * Receives live steps tailed from `~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl`
 * (or direct POSTs to `/event/antigravity`) and tracks Gemini 4 Argon, f3.8, Flash, etc.
 */
export class AntigravityAdapter extends AgentAdapter {
  source = "antigravity";
  name = "Antigravity";
  color = "#4285F4";

  #turns = new Map();
  #meta = new Map(); // session_id → { model, project }

  normalize(p) {
    if (!p) return null;

    // Support direct generic payloads sent to /event/antigravity
    if (VALID_STATES.has(p.state)) {
      const progress = typeof p.progress === "number" ? Math.min(Math.max(p.progress, 0), 1) : null;
      const model = p.model ? formatModelName(p.model) : null;
      return {
        id: p.id ?? p.session_id ?? "default",
        state: p.state,
        label: p.label,
        progress,
        tokens: p.tokens ?? null,
        project: p.project ?? "",
        headline: p.headline ?? null,
        details: p.details ? { ...p.details, ...(model ? { model } : {}) } : model ? { model } : null,
      };
    }

    const id = p.session_id ?? p.id;
    if (!id) return null;
    const prev = this.#meta.get(id) ?? { model: "Gemini 4 Argon (f3.8)", project: "" };
    const saved = {
      model: p._model ? formatModelName(p._model) : prev.model,
      project: p._project || prev.project,
    };
    this.#meta.set(id, saved);

    switch (p.type) {
      case "USER_INPUT": {
        const content = String(p.content ?? "");
        const prompt = extractTag(content, "USER_REQUEST");
        const model = extractModelSelection(content) ?? (p.model ? formatModelName(p.model) : saved.model);
        const project = extractProjectFromMetadata(content) || saved.project;
        this.#meta.set(id, { model, project });
        const turn = this.#newTurn(id, prompt, model, project);
        return this.#out(id, turn, { state: State.THINKING, label: turn.label, progress: turn.progress });
      }

      case "CHECKPOINT": {
        const turn = this.#turn(id, saved);
        turn.label = "Compacte le contexte…";
        return this.#out(id, turn, { state: State.THINKING, label: turn.label, progress: this.#progress(turn) });
      }

      case "PLANNER_RESPONSE": {
        const turn = this.#turn(id, saved);
        if (p.model) {
          turn.model = formatModelName(p.model);
          this.#meta.set(id, { model: turn.model, project: turn.project });
        }
        const inTok = (p.input_tokens ?? 0) + (p.cache_read_tokens ?? 0);
        const outTok = p.output_tokens ?? 0;
        if (inTok || outTok) turn.tokens += inTok + outTok;

        const calls = Array.isArray(p.tool_calls) ? p.tool_calls : [];
        if (calls.length > 0) {
          for (const tc of calls) {
            turn.steps++;
            const args = parseArgs(tc.args);
            const path = args.Path ?? args.TargetFile ?? args.AbsolutePath ?? args.DirectoryPath ?? "";
            if (!turn.project && path) {
              turn.project = inferProjectFromPath(path);
              this.#meta.set(id, { model: turn.model, project: turn.project });
            }
            if (EDIT_TOOLS.has(tc.name) && path) turn.files.add(path);
            if (tc.name === "invoke_subagent") turn.subagents++;
            turn.label = this.#describeTool(tc.name, args);
          }
          if (calls.some((tc) => tc.name === "ask_question")) {
            return this.#out(id, turn, { state: State.ATTENTION, label: "A besoin de ta réponse !" });
          }
          return this.#out(id, turn, { state: State.TOOL, label: turn.label, progress: this.#progress(turn) });
        }

        // No tool calls: if a background task is still running, stay in TOOL state.
        if (turn.backgroundRunning) {
          return this.#out(id, turn, { state: State.TOOL, label: turn.label, progress: this.#progress(turn) });
        }

        if (p.status === "DONE") {
          this.#turns.delete(id);
          const who = turn.project || turn.model || this.name;
          return this.#out(id, turn, {
            state: State.DONE,
            headline: `${who} a fini !`,
            label: `Terminé en ${duration(Date.now() - turn.startedAt)}`,
          });
        }
        return this.#out(id, turn, { state: State.STREAMING, label: "Écrit…", progress: this.#progress(turn) });
      }

      case "SYSTEM_MESSAGE": {
        const turn = this.#turn(id, saved);
        turn.backgroundRunning = false;
        return this.#out(id, turn, { state: State.THINKING, label: "Analyse le résultat…", progress: this.#progress(turn) });
      }

      case "GENERIC":
      case "VIEW_FILE":
      case "LIST_DIRECTORY":
      case "GREP_SEARCH": {
        const turn = this.#turn(id, saved);
        if (p.status === "RUNNING") {
          turn.backgroundRunning = true;
          return this.#out(id, turn, { state: State.TOOL, label: turn.label, progress: this.#progress(turn) });
        }
        if (p.status === "ERROR") {
          turn.errors++;
          return this.#out(id, turn, { state: State.THINKING, label: `Échec : ${turn.label}`, progress: this.#progress(turn) });
        }
        return this.#out(id, turn, { state: State.THINKING, label: turn.label, progress: this.#progress(turn) });
      }

      default:
        return null;
    }
  }

  #out(id, turn, rest) {
    return {
      id,
      project: turn.project,
      tokens: turn.tokens || null,
      details: this.#details(turn),
      ...rest,
    };
  }

  #newTurn(id, prompt, model, project) {
    const turn = {
      startedAt: Date.now(),
      prompt: prompt ? truncate(prompt, 80) : "",
      model: model || "Gemini 4 Argon (f3.8)",
      project: project || "",
      steps: 0,
      tokens: 0,
      files: new Set(),
      errors: 0,
      subagents: 0,
      progress: 0.04,
      label: "Réfléchit…",
      backgroundRunning: false,
    };
    this.#turns.set(id, turn);
    return turn;
  }

  #turn(id, saved) {
    return this.#turns.get(id) ?? this.#newTurn(id, "", saved.model, saved.project);
  }

  #progress(turn) {
    const value = MAX_ESTIMATE * (1 - Math.exp(-turn.steps / STEP_SCALE));
    turn.progress = Math.min(0.97, Math.max(turn.progress, value));
    return turn.progress;
  }

  #details(turn) {
    return {
      prompt: turn.prompt,
      model: turn.model,
      startedAt: turn.startedAt,
      steps: turn.steps,
      files: turn.files.size,
      errors: turn.errors,
      subagents: turn.subagents,
      step: null,
    };
  }

  #describeTool(name, args) {
    const file = basename(args.Path ?? args.TargetFile ?? args.AbsolutePath ?? args.DirectoryPath);
    switch (name) {
      case "edit_file":
      case "multi_edit":
      case "replace_file_content":
      case "multi_replace_file_content":
        return `Modifie ${file || "un fichier"}`;
      case "write_file":
      case "write_to_file":
        return `Écrit ${file || "un fichier"}`;
      case "read_file":
      case "view_file":
      case "view_file_outline":
      case "view_code_item":
        return `Lit ${file || "un fichier"}`;
      case "run_command":
        return args.toolSummary ? truncate(args.toolSummary) : `Lance : ${truncate(args.CommandLine ?? "")}`;
      case "grep_search":
        return `Cherche « ${truncate(args.Query ?? "", 24)} »`;
      case "list_dir":
      case "find_by_name":
        return `Explore ${file || "le dossier"}`;
      case "search_web":
      case "read_url_content":
        return `Cherche : ${truncate(args.query ?? args.Url ?? "", 30)}`;
      case "invoke_subagent":
        return `Délègue : ${truncate(args.Role ?? args.TypeName ?? "sous-agent")}`;
      case "call_mcp_tool":
        return `Utilise ${args.ServerName ?? args.ToolName ?? "MCP"}`;
      default:
        return args.toolSummary ? truncate(args.toolSummary) : name ? `Utilise ${name}` : "Travaille…";
    }
  }
}

export function formatModelName(raw) {
  if (!raw) return "Gemini 4 Argon (f3.8)";
  const cleaned = String(raw).trim().replace(/\s*\((Medium|High|Low)\)$/i, "").trim();
  const lower = cleaned.toLowerCase();
  if (lower === "f3.8" || lower === "gemini 4 argon" || lower === "gemini-4-argon" || lower === "gemini 4 argon (f3.8)") {
    return "Gemini 4 Argon (f3.8)";
  }
  if (lower === "gemini 3.8 flash" || lower === "gemini-3.8-flash" || lower === "f3.8-flash" || lower === "f3.8 flash") {
    return "Gemini 3.8 Flash";
  }
  if (lower === "gemini 3.5 flash" || lower === "gemini-3.5-flash") {
    return "Gemini 3.5 Flash";
  }
  if (lower === "gemini 2.5 flash" || lower === "gemini-2.5-flash") {
    return "Gemini 2.5 Flash";
  }
  if (lower === "gemini 2.5 pro" || lower === "gemini-2.5-pro") {
    return "Gemini 2.5 Pro";
  }
  return cleaned;
}

function extractTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function extractModelSelection(text) {
  // "…`Model Selection` from A to Gemini 3.1 Pro (High). No need…": versions have dots, so stop at ". ".
  const m = text.match(/setting `Model Selection` from .+? to (.+?)(?:\.\s|\.?$|\r|\n)/im);
  if (!m) return null;
  const val = m[1].replace(/`/g, "").trim();
  return val && val.toLowerCase() !== "none" ? formatModelName(val) : null;
}

function extractProjectFromMetadata(text) {
  const meta = extractTag(text, "ADDITIONAL_METADATA");
  if (!meta) return "";
  const docMatch = meta.match(/(?:Active Document|-\s*)([A-Za-z]:[\\/][^\r\n(]+)/);
  return docMatch ? inferProjectFromPath(docMatch[1].trim()) : "";
}

function inferProjectFromPath(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  const devIdx = parts.findIndex((p) => /^(dev|projects|repos|workspace|workspaces)$/i.test(p));
  if (devIdx >= 0 && parts[devIdx + 1]) return parts[devIdx + 1];
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? "";
}

function parseArgs(rawArgs) {
  if (!rawArgs || typeof rawArgs !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    if (typeof v === "string" && v.startsWith('"') && v.endsWith('"')) {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {
        // keep raw string
      }
    }
    out[k] = v;
  }
  return out;
}

function basename(path) {
  return path ? String(path).split(/[\\/]/).filter(Boolean).pop() : "";
}

function truncate(text, max = 40) {
  const line = String(text).split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

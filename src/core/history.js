/**
 * Finished tasks, kept in localStorage (shared by the ghost and settings windows,
 * which have the same origin). Only local conveniences: nothing else depends on it.
 */
import { describeModel } from "./models.js";

const KEY = "booffer.history";
const MAX_ENTRIES = 200;

export function loadHistory() {
  try {
    const entries = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/** @param session a tracker session that just finished */
export function recordFinished(session) {
  const d = session.details ?? {};
  const entry = {
    at: Date.now(),
    project: session.project || "",
    agent: d.model ? `${session.agent} · ${describeModel(d.model).name}` : session.agent,
    color: session.color,
    prompt: d.prompt || "",
    ms: d.startedAt ? Date.now() - d.startedAt : 0,
    steps: d.steps ?? 0,
    files: d.files ?? 0,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...loadHistory()].slice(0, MAX_ENTRIES)));
  } catch {
    // Storage unavailable or full: the history is a nice-to-have.
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

export function todayStats(entries) {
  const midnight = new Date().setHours(0, 0, 0, 0);
  const today = entries.filter((e) => e.at >= midnight);
  return {
    tasks: today.length,
    ms: today.reduce((sum, e) => sum + e.ms, 0),
    files: today.reduce((sum, e) => sum + e.files, 0),
  };
}

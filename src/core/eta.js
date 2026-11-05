/**
 * Remaining time of a running session, shown as "≈ 3 min left".
 *
 * Best source first:
 *  0. a remaining time given by the agent itself (a command in the terminal: its own %);
 *  1. a todo list with at least one task done: time per task so far × tasks left;
 *  2. how long this agent's tasks usually take on this PC (median of the history);
 *  3. the progress estimate, once it is far enough along to mean something.
 * When a task runs past its typical length, the progress estimate takes over (or, early on,
 * a third of the time spent so far), so the estimate grows gently instead of saying "0 s".
 *
 * The % shown next to it comes from the same estimate (time spent / time spent + time left),
 * unless the agent knows its real progress (todo list, terminal %): a task can't say "50%"
 * and "55 s left" after 3 minutes any more.
 *
 * Raw estimates jump around at every event; we keep a finish *time*, move it only
 * part of the way toward each new estimate, and count down to it between events.
 */
import { loadHistory } from "./history.js";

const BLEND = 0.35;
const MIN_ELAPSED_MS = 10_000;
const MIN_PROGRESS = 0.15;
/** Typical durations need a few finished tasks to be worth anything. */
const MIN_SAMPLES = 3;
const SAMPLES = 30;

export class EtaEstimator {
  #byKey = new Map(); // session key → { turn, finishAt, lastUpdate, estimatedAt }
  #typical = { at: 0, byAgent: new Map() };

  /** @returns remaining ms, `0` for "any moment now", or null when unknown. */
  remaining(session) {
    const d = session.details ?? {};
    const now = Date.now();
    const turn = d.startedAt ?? 0;
    let entry = this.#byKey.get(session.key);
    if (entry?.turn !== turn) {
      entry = { turn, finishAt: null, lastUpdate: null, estimatedAt: 0, shown: 0 };
      this.#byKey.set(session.key, entry);
    }

    // New information arrives with events; between them, re-estimate every 5 s at most.
    if (entry.lastUpdate !== session.updatedAt || now - entry.estimatedAt > 5000) {
      entry.lastUpdate = session.updatedAt;
      entry.estimatedAt = now;
      const raw = this.#raw(session, d, now);
      if (raw === null) entry.finishAt = null;
      else if (entry.finishAt === null) entry.finishAt = now + raw;
      else entry.finishAt += (now + raw - entry.finishAt) * BLEND;
    }
    return entry.finishAt === null ? null : Math.max(0, entry.finishAt - now);
  }

  /**
   * The progress to show (0…1), or null: the agent's own when it is real (todo list, a % read in
   * the terminal), otherwise time spent / (time spent + time left), never going backwards.
   */
  progress(session) {
    const d = session.details ?? {};
    const own = typeof session.progress === "number" ? session.progress : null;
    if (session.state === "done") return 1;
    if (d.step || typeof d.percent === "number" || !d.startedAt) return own;
    const left = this.remaining(session);
    const entry = this.#byKey.get(session.key);
    if (left === null || !entry) return own;
    const elapsed = Date.now() - d.startedAt;
    const fromTime = Math.min(0.97, Math.max(0.03, elapsed / (elapsed + left)));
    entry.shown = Math.max(entry.shown, fromTime);
    return entry.shown;
  }

  #raw(session, d, now) {
    if (typeof d.etaMs === "number") return Math.max(0, d.etaMs - (now - (d.etaAt ?? now)));
    // A real % without a pace yet (terminal): only from the %, never from other tasks' lengths.
    if (typeof d.percent === "number") {
      const spent = now - (d.startedAt ?? now);
      return d.percent >= MIN_PROGRESS && spent > 0 ? (spent * (1 - d.percent)) / d.percent : null;
    }
    if (!d.startedAt) return null;
    const elapsed = now - d.startedAt;
    if (elapsed < MIN_ELAPSED_MS) return null;

    const step = d.step;
    const done = step ? step.index - 1 : 0; // tasks completed before the current one
    if (step && step.count >= 2 && done >= 1) {
      const progressed = done + (step.progress ?? 0);
      return (elapsed / progressed) * (step.count - progressed);
    }

    const p = session.progress ?? 0;
    const fromProgress = p >= MIN_PROGRESS ? (elapsed * (1 - p)) / p : null;
    const typical = this.#typicalMs(session.agent);
    if (typical && elapsed < typical * 0.9) return typical - elapsed;
    if (typical) return Math.max(fromProgress ?? 0, elapsed * 0.35);
    return fromProgress;
  }

  /** Median duration of this agent's last finished tasks (history is re-read once a minute). */
  #typicalMs(agent) {
    if (Date.now() - this.#typical.at > 60_000) {
      const byAgent = new Map();
      for (const e of loadHistory()) {
        const name = String(e.agent ?? "").split(" · ")[0];
        if (!e.ms) continue;
        const list = byAgent.get(name) ?? [];
        if (list.length < SAMPLES) list.push(e.ms);
        byAgent.set(name, list);
      }
      this.#typical = { at: Date.now(), byAgent };
    }
    const list = [...(this.#typical.byAgent.get(agent) ?? [])].sort((a, b) => a - b);
    return list.length >= MIN_SAMPLES ? list[Math.floor(list.length / 2)] : null;
  }
}

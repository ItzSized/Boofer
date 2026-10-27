/**
 * Remaining time of a running session, shown as « reste ≈ 3 min ».
 *
 * Only estimated when there is something real to go on: a todo list with at
 * least one task done (time per task so far × tasks left). The plain "number of
 * actions" progress is a guess that flattens out near the end, so it never gives an ETA.
 *
 * Raw estimates jump around at every event; we keep a finish *time*, move it only
 * part of the way toward each new estimate, and count down to it between events.
 */
const BLEND = 0.35;
const MIN_ELAPSED_MS = 15_000;

export class EtaEstimator {
  #byKey = new Map(); // session key → { turn, finishAt, lastUpdate }

  /** @returns remaining ms, `0` for "any moment now", or null when unknown. */
  remaining(session) {
    const d = session.details ?? {};
    const now = Date.now();
    const turn = d.startedAt ?? 0;
    let entry = this.#byKey.get(session.key);
    if (entry?.turn !== turn) {
      entry = { turn, finishAt: null, lastUpdate: null };
      this.#byKey.set(session.key, entry);
    }

    // New information only arrives with an event: don't recompute on the 1 s timer.
    if (entry.lastUpdate !== session.updatedAt) {
      entry.lastUpdate = session.updatedAt;
      const raw = rawEstimate(d, now);
      if (raw === null) entry.finishAt = null;
      else if (entry.finishAt === null) entry.finishAt = now + raw;
      else entry.finishAt += (now + raw - entry.finishAt) * BLEND;
    }
    return entry.finishAt === null ? null : Math.max(0, entry.finishAt - now);
  }
}

function rawEstimate(d, now) {
  const step = d.step;
  if (!step || !d.startedAt || step.count < 2) return null;
  const done = step.index - 1; // tasks completed before the current one
  const elapsed = now - d.startedAt;
  if (done < 1 || elapsed < MIN_ELAPSED_MS) return null;
  const progressed = done + (step.progress ?? 0);
  return (elapsed / progressed) * (step.count - progressed);
}

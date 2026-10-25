import { ACTIVE_STATES, PRIORITY, State } from "./states.js";

const DONE_LINGER_MS = 8000;
/** No news from an active session for this long: it probably crashed. */
const STALE_ACTIVE_MS = 10 * 60 * 1000;
/** Idle sessions (finished, waiting for the next prompt) are forgotten after this. */
const FORGET_IDLE_MS = 60 * 60 * 1000;
/** Second, third… session of the same agent get their own ghost color. */
const SESSION_COLORS = ["#3FB98F", "#E07AC0", "#5B8CFF", "#E8B04B"];

/**
 * Keeps one entry per (agent, session). Finished sessions stay around as
 * "idle" so they keep their tab and color until the agent session ends.
 * Emits:
 *  - "change"   → { current, sessions }
 *  - "finished" → session that just went active → done
 */
export class Tracker {
  #sessions = new Map();
  #colorIndex = 0;

  constructor(bus) {
    this.bus = bus;
    setInterval(() => this.#sweep(), 30_000);
  }

  /** @param {import("../agents/base-adapter.js").AgentAdapter} adapter */
  update(adapter, { id, state, label, progress = null, tokens = null, project = "", headline = null, details = null }) {
    const key = `${adapter.source}:${id ?? "default"}`;
    const previous = this.#sessions.get(key);

    if (state === State.IDLE && !previous) return;
    if (state === State.IDLE && label === undefined) {
      this.#sessions.delete(key); // the agent session ended
      return this.#publish();
    }

    const session = {
      key,
      agent: adapter.name,
      color: previous?.color ?? this.#pickColor(adapter),
      state,
      label: label ?? adapter.defaultLabel(state),
      headline,
      project: project || previous?.project || "",
      progress: state === State.DONE ? 1 : progress,
      tokens,
      details: details ?? previous?.details ?? null,
      startedAt: previous?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    this.#sessions.set(key, session);

    if (state === State.DONE && previous && (ACTIVE_STATES.has(previous.state) || previous.state === State.ATTENTION)) {
      this.bus.emit("finished", session);
    }
    if (state === State.DONE || state === State.ERROR) {
      setTimeout(() => {
        const s = this.#sessions.get(key);
        if (s?.updatedAt === session.updatedAt) {
          this.#sessions.set(key, { ...s, state: State.IDLE, headline: null, label: "En attente de ta demande" });
          this.#publish();
        }
      }, DONE_LINGER_MS);
    }
    this.#publish();
  }

  get(key) {
    return this.#sessions.get(key) ?? null;
  }

  #pickColor(adapter) {
    const sameAgent = [...this.#sessions.values()].some((s) => s.agent === adapter.name);
    if (!sameAgent) return adapter.color;
    return SESSION_COLORS[this.#colorIndex++ % SESSION_COLORS.length];
  }

  #current() {
    let best = null;
    for (const s of this.#sessions.values()) {
      if (!best || PRIORITY[s.state] > PRIORITY[best.state] ||
          (PRIORITY[s.state] === PRIORITY[best.state] && s.updatedAt > best.updatedAt)) {
        best = s;
      }
    }
    return best;
  }

  #publish() {
    this.bus.emit("change", { current: this.#current(), sessions: [...this.#sessions.values()] });
  }

  #sweep() {
    const now = Date.now();
    let changed = false;
    for (const [key, s] of this.#sessions) {
      const age = now - s.updatedAt;
      if (s.state === State.IDLE && age > FORGET_IDLE_MS) {
        changed = this.#sessions.delete(key);
      } else if (ACTIVE_STATES.has(s.state) && age > STALE_ACTIVE_MS) {
        this.#sessions.set(key, { ...s, state: State.IDLE, label: "Plus de nouvelles" });
        changed = true;
      }
    }
    if (changed) this.#publish();
  }
}

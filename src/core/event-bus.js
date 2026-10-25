/** Minimal pub/sub so modules never import each other directly. */
export class EventBus {
  #handlers = new Map();

  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.#handlers.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this.#handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

/** Out-of-order events held per session at most; past it the held ones are
 * dropped and a fresh replay is asked for. */
const MAX_PENDING_EVENTS = 2000;

/** Hold out-of-order gateway events until all earlier events are projected. */
export class LegacyEventRecovery<T> {
  private pending = new Map<string, Map<number, T>>();
  private requested = new Set<string>();

  receive(key: string, cursor: number, event: T, applied: () => number,
    project: (event: T) => void, commit: (cursor: number) => void,
    replay: (after: number) => boolean): void {
    if (cursor <= applied()) return;
    let queue = this.pending.get(key) ?? new Map<number, T>();
    if (queue.size >= MAX_PENDING_EVENTS) {
      // The gap is not closing (a lost replay): start over from the cursor.
      queue = new Map<number, T>();
      this.requested.delete(key);
    }
    this.pending.set(key, queue);
    queue.set(cursor, event);
    while (queue.has(applied() + 1)) {
      const next = applied() + 1;
      project(queue.get(next)!);
      commit(next);
      queue.delete(next);
    }
    if (!queue.size) {
      this.pending.delete(key);
      this.requested.delete(key);
    } else if (!this.requested.has(key)) {
      if (replay(applied())) this.requested.add(key);
    }
  }

  /** Forgets which replays were asked for (a socket closed, so their answers
   * will not come); events still held stay and ask again on the next one. */
  resetRequests(): void {
    this.requested.clear();
  }
}

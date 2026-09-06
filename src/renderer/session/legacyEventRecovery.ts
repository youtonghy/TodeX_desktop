/** Hold out-of-order gateway events until all earlier events are projected. */
export class LegacyEventRecovery<T> {
  private pending = new Map<string, Map<number, T>>();
  private requested = new Set<string>();

  receive(key: string, cursor: number, event: T, applied: () => number,
    project: (event: T) => void, commit: (cursor: number) => void,
    replay: (after: number) => boolean): void {
    if (cursor <= applied()) return;
    const queue = this.pending.get(key) ?? new Map<number, T>();
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
}

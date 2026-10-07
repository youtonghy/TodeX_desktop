/** Serializes local follow-ups. The queue pauses when the previous turn ends
 * abnormally and stays paused — across reconnects and reloads too — until the
 * user resumes it; every other trigger only moves an unpaused queue. */
export class QueuedFollowUps {
  private readonly sending = new Set<string>();
  private readonly advance = new Set<string>();
  private readonly terminals = new Set<string>();
  private readonly paused = new Set<string>();

  isPaused(id: string) { return this.paused.has(id); }
  pause(id: string) { this.paused.add(id); }
  /** Lifts a pause without sending; the next trigger moves the queue. */
  unpause(id: string) { this.paused.delete(id); }
  /** Conversations whose queue is paused, for persisting with the candidates. */
  pausedIds(): string[] { return [...this.paused]; }

  async settle<T extends { id: string }>(id: string, turnId: string, terminal: string,
    recovering: boolean, next: () => T | undefined,
    send: (item: T) => Promise<boolean>, remove: (itemId: string) => void): Promise<void> {
    const key = `${id}:${turnId}`;
    if (recovering || !turnId || this.terminals.has(key)) return;
    this.terminals.add(key);
    if (this.terminals.size > 2000) this.terminals.delete(this.terminals.values().next().value!);
    if (terminal !== 'turn.completed') { this.pause(id); return; }
    if (!this.paused.has(id)) await this.dispatch(id, next, send, remove, true);
  }

  /** The user's explicit "continue": lifts the pause, then sends the head. */
  async resume<T extends { id: string }>(id: string, next: () => T | undefined,
    send: (item: T) => Promise<boolean>, remove: (itemId: string) => void): Promise<void> {
    this.paused.delete(id);
    await this.dispatch(id, next, send, remove);
  }

  /** Automatic triggers (reconnect, reload, provider refresh): sends the head
   * only while the queue is not paused. */
  async drain<T extends { id: string }>(id: string, next: () => T | undefined,
    send: (item: T) => Promise<boolean>, remove: (itemId: string) => void): Promise<void> {
    if (this.paused.has(id)) return;
    await this.dispatch(id, next, send, remove);
  }

  private async dispatch<T extends { id: string }>(id: string, next: () => T | undefined,
    send: (item: T) => Promise<boolean>, remove: (itemId: string) => void, advanceIfBusy = false): Promise<void> {
    if (this.sending.has(id)) {
      if (advanceIfBusy) this.advance.add(id);
      return;
    }
    const item = next();
    if (!item) return;
    this.sending.add(id);
    try {
      if (await send(item)) remove(item.id);
      // A failed send keeps the item queued; the next trigger retries it.
    } catch { /* Item stays queued; the next trigger retries it. */ }
    finally {
      this.sending.delete(id);
      const advance = this.advance.delete(id);
      if (advance && !this.paused.has(id)) await this.dispatch(id, next, send, remove);
    }
  }
}

/** Storage shape of `todex.queued-follow-ups.v1`. Version 1 stored the
 * conversation → candidates map alone and is still read (as unpaused). */
type StoredQueuedFollowUps<T> = { version: 2; queues: Record<string, T[]>; paused: string[] };

export function serializeQueuedFollowUps<T>(queues: Record<string, T[]>, paused: Iterable<string>): StoredQueuedFollowUps<T> {
  // A pause only matters while candidates wait behind it.
  return { version: 2, queues, paused: [...new Set(paused)].filter((id) => (queues[id]?.length ?? 0) > 0) };
}

export function restoreQueuedFollowUps<T extends { id: string; text: string; attachments: unknown[]; skills: unknown[] }>(value: unknown): {
  queues: Record<string, T[]>;
  paused: string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { queues: {}, paused: [] };
  const stored = value as Partial<StoredQueuedFollowUps<unknown>>;
  const versioned = stored.version === 2;
  const queues = restoreQueues<T>(versioned ? stored.queues : value);
  const paused = versioned && Array.isArray(stored.paused)
    ? [...new Set(stored.paused.filter((id): id is string => typeof id === 'string' && id in queues))] : [];
  return { queues, paused };
}

function restoreQueues<T extends { id: string; text: string; attachments: unknown[]; skills: unknown[] }>(value: unknown): Record<string, T[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, items]) => {
    if (!Array.isArray(items)) return [];
    const valid = items.filter((item): item is T => item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.text === 'string'
      && Array.isArray(item.attachments) && Array.isArray(item.skills)).slice(0, 32);
    return valid.length ? [[id, valid]] : [];
  }));
}

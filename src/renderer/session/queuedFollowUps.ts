/** Serializes local follow-ups. Only a live terminal event belonging to a
 * submission made by this client can automatically advance the queue. */
export class QueuedFollowUps {
  private readonly sending = new Set<string>();
  private readonly advance = new Set<string>();
  private readonly terminals = new Set<string>();
  private readonly paused = new Set<string>();

  isPaused(id: string) { return this.paused.has(id); }
  pause(id: string) { this.paused.add(id); }

  async settle<T extends { id: string }>(id: string, turnId: string, terminal: string,
    liveSubmission: boolean, recovering: boolean, next: () => T | undefined,
    send: (item: T) => Promise<boolean>, remove: (itemId: string) => void): Promise<void> {
    const key = `${id}:${turnId}`;
    if (recovering || !liveSubmission || !turnId || this.terminals.has(key)) return;
    this.terminals.add(key);
    if (this.terminals.size > 2000) this.terminals.delete(this.terminals.values().next().value!);
    if (terminal !== 'turn.completed') { this.pause(id); return; }
    if (!this.paused.has(id)) await this.dispatch(id, next, send, remove, true);
  }

  async resume<T extends { id: string }>(id: string, next: () => T | undefined,
    send: (item: T) => Promise<boolean>, remove: (itemId: string) => void): Promise<void> {
    this.paused.delete(id);
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
      else this.pause(id); // Includes an unknown ACK: never blindly resend.
    } catch { this.pause(id); }
    finally {
      this.sending.delete(id);
      const advance = this.advance.delete(id);
      if (advance && !this.paused.has(id)) await this.dispatch(id, next, send, remove);
    }
  }
}

export function restoreQueuedFollowUps<T extends { id: string; text: string; attachments: unknown[]; skills: unknown[] }>(value: unknown): Record<string, T[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, items]) => {
    if (!Array.isArray(items)) return [];
    const valid = items.filter((item): item is T => item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.text === 'string'
      && Array.isArray(item.attachments) && Array.isArray(item.skills)).slice(0, 32);
    return valid.length ? [[id, valid]] : [];
  }));
}

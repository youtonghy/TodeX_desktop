/** One-time migration of the candidate queue older builds kept in the client
 * (`todex.queued-follow-ups.v1`). The backend now holds queued messages, so
 * the stored candidates are handed to it once and the local copy is deleted. */
type LegacyItem = { id: string; text: string; attachments: unknown[]; skills: unknown[] };

/** Storage shape of `todex.queued-follow-ups.v1`. Version 1 stored the
 * conversation → candidates map alone and is still read (as unpaused). */
type StoredQueuedFollowUps<T> = { version: 2; queues: Record<string, T[]>; paused: string[] };

export type LegacyFollowUps<T> = { queues: Record<string, T[]>; paused: string[] };

export function restoreQueuedFollowUps<T extends LegacyItem>(value: unknown): LegacyFollowUps<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { queues: {}, paused: [] };
  const stored = value as Partial<StoredQueuedFollowUps<unknown>>;
  const versioned = stored.version === 2;
  const queues = restoreQueues<T>(versioned ? stored.queues : value);
  const paused = versioned && Array.isArray(stored.paused)
    ? [...new Set(stored.paused.filter((id): id is string => typeof id === 'string' && id in queues))] : [];
  return { queues, paused };
}

function restoreQueues<T extends LegacyItem>(value: unknown): Record<string, T[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, items]) => {
    if (!Array.isArray(items)) return [];
    const valid = items.filter((item): item is T => item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.text === 'string'
      && Array.isArray(item.attachments) && Array.isArray(item.skills)).slice(0, 32);
    return valid.length ? [[id, valid]] : [];
  }));
}

/** Where a stored conversation's candidates can go right now:
 * - `wait`: not decidable yet (other backend, providers not loaded, the
 *   backend has no queue); the local copy stays for the next connection;
 * - `gone`: the conversation no longer exists or is read-only;
 * - `ready`: its provider has a backend queue; `control` is whether that
 *   queue can take an item in the paused state. */
export type LegacyQueueTarget = { kind: 'wait' } | { kind: 'gone' } | { kind: 'ready'; control: boolean };

/** `added` also covers an item the backend already holds (the original id is
 * the idempotency key); `gone` is a read-only refusal; `failed` is transient. */
export type LegacyAddResult = 'added' | 'gone' | 'failed';

export type LegacyQueueHooks<T> = {
  resolve: (conversationId: string) => LegacyQueueTarget;
  /** Adds one candidate under its original id; `paused` enqueues it paused. */
  add: (conversationId: string, item: T, paused: boolean) => Promise<LegacyAddResult>;
  /** The conversation's local copy is settled and must be deleted. `discarded`
   * holds what could not be delivered (the user is told); empty when all moved. */
  settle: (conversationId: string, discarded: T[]) => void;
};

/** Moves every stored conversation's candidates to the backend, in order. A
 * conversation that was paused stays paused (its first item is added paused);
 * when the backend cannot hold a pause the conversation waits instead of
 * being resumed. A local copy is only settled after every add succeeded. */
export async function migrateLegacyFollowUps<T extends LegacyItem>(
  legacy: LegacyFollowUps<T>,
  hooks: LegacyQueueHooks<T>,
): Promise<void> {
  for (const [conversationId, items] of Object.entries(legacy.queues)) {
    const target = hooks.resolve(conversationId);
    if (target.kind === 'wait') continue;
    if (target.kind === 'gone') { hooks.settle(conversationId, items); continue; }
    const paused = legacy.paused.includes(conversationId);
    if (paused && !target.control) continue;
    let outcome: LegacyAddResult = 'added';
    for (const [index, item] of items.entries()) {
      outcome = await hooks.add(conversationId, item, paused && index === 0);
      if (outcome !== 'added') break;
    }
    if (outcome === 'added') hooks.settle(conversationId, []);
    else if (outcome === 'gone') hooks.settle(conversationId, items);
  }
}

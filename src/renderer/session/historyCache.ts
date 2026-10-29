import { isHistoryEncryptedPayload, type HistoryWireEvent, type HistoryWrapsFetcher } from '@todex/protocol/historyEncryption';
import type { HistoryWrappedKeyJson } from '@todex/protocol/historyCrypto';
import { platform } from '../platform';

// Desktop history cache: the newest events of recently opened conversations,
// kept on this device exactly as the backend sent them — end-to-end
// ciphertext — plus the wrapped DEKs addressed to this device. Reading it
// needs the device's history seed from the OS keychain, so it protects no
// less than the backend's own data directory. A conversation opens from it
// at once and then catches up from the journal; see docs/conversation-runtime.md.
// Platforms without `platform.historyCache` (web) keep no cache.

/** Events kept per conversation: one lazy history window. */
export const HISTORY_CACHE_TAIL_EVENTS = 300;
export const HISTORY_CACHE_MAX_CONVERSATIONS = 100;
export const HISTORY_CACHE_MAX_BYTES = 200 * 1024 * 1024;
/** A changed tail is written once it has been quiet this long. */
export const HISTORY_CACHE_FLUSH_DELAY_MS = 5_000;
/** Conversations whose capture buffer stays in memory. */
const MAX_BUFFERS = HISTORY_CACHE_MAX_CONVERSATIONS;

export type StoredHistoryTail = {
  key: string;
  events: HistoryWireEvent[];
  frames: Record<string, unknown>;
};
export type HistoryTailMeta = {
  key: string;
  backendId: string;
  rid: string;
  conversationId: string;
  firstSequence: number;
  lastSequence: number;
  savedAt: number;
  usedAt: number;
  bytes: number;
};
export type StoredHistoryWrap = { key: string; wrap: HistoryWrappedKeyJson };

/** Persistence behind the cache (IndexedDB on desktop, lib/historyCacheIdb.ts).
 * Every key starts with `${backendId}\0`. */
export type HistoryCacheStore = {
  getTail: (key: string) => Promise<StoredHistoryTail | undefined>;
  putTail: (tail: StoredHistoryTail, meta: HistoryTailMeta) => Promise<void>;
  putTailMeta: (meta: HistoryTailMeta) => Promise<void>;
  listTailMeta: () => Promise<HistoryTailMeta[]>;
  deleteTails: (keys: string[]) => Promise<void>;
  getWraps: (keys: string[]) => Promise<Record<string, HistoryWrappedKeyJson>>;
  putWraps: (entries: StoredHistoryWrap[]) => Promise<void>;
  deleteWraps: (keys: string[]) => Promise<void>;
  listWrapKeys: (backendId: string) => Promise<string[]>;
  deleteBackend: (backendId: string) => Promise<void>;
  clear: () => Promise<void>;
};

/** A cached tail ready to decrypt: ascending, contiguous sequences. */
export type CachedHistoryTail = { events: HistoryWireEvent[]; frames: Record<string, unknown> };

type Buffer = {
  backendId: string;
  conversationId: string;
  events: Map<number, HistoryWireEvent>;
  frames: Record<string, unknown>;
  dirty: boolean;
  touchedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type SettingsStore = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> };

const tailKey = (backendId: string, rid: string, conversationId: string) => `${backendId}\u0000${rid}\u0000${conversationId}`;
const wrapKey = (backendId: string, rid: string, conversationId: string, kid: string) => `${tailKey(backendId, rid, conversationId)}\u0000${kid}`;
const bufferKey = (backendId: string, conversationId: string) => `${backendId}\u0000${conversationId}`;

const sequenceOf = (event: HistoryWireEvent) => (typeof event.sequence === 'number' && Number.isInteger(event.sequence) && event.sequence > 0 ? event.sequence : 0);

/** The cached copy of a wire event: the full-detail ciphertext is dropped
 * when a summary one exists, since cached history opens at summary detail
 * like any lazily loaded window (rows hydrate in full on expand). */
function cachedEvent(event: HistoryWireEvent): HistoryWireEvent {
  const payload = event.payload as Record<string, unknown>;
  const enc = payload.$enc as Record<string, unknown>;
  if (typeof enc.s !== 'string' || enc.f === undefined) return event;
  const { f: _full, ...summaryOnly } = enc;
  return { ...event, payload: { ...payload, $enc: summaryOnly } };
}

function frameIdsOf(event: HistoryWireEvent): string[] {
  const ref = ((event.payload as Record<string, unknown> | undefined)?.$enc as Record<string, unknown> | undefined)?.fr;
  if (!ref || typeof ref !== 'object') return [];
  return Object.values(ref as Record<string, unknown>).filter((value): value is string => typeof value === 'string');
}

const warn = (action: string, error: unknown) => console.warn(`[history-cache] ${action} failed`, error);

export class HistoryTailCache {
  private readonly buffers = new Map<string, Buffer>();
  /** Conversations that delivered plaintext (legacy history): never cached. */
  private readonly plaintext = new Set<string>();
  private enabled = true;
  private loading: Promise<void> | null = null;
  private recipientFor: (backendId: string) => Promise<string | undefined> = async () => undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: HistoryCacheStore,
    private readonly settings: SettingsStore,
    private readonly settingsKey: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** The switch loads on first use: the desktop store is not reachable yet
   * while modules load (the demo installs its bridge afterwards). */
  private get loaded(): Promise<void> {
    this.loading ??= this.settings.get(this.settingsKey).then((value) => {
      const stored = value as { enabled?: unknown } | null | undefined;
      if (stored && stored.enabled === false) this.enabled = false;
      this.changed();
    }, (error: unknown) => warn('load settings', error));
    return this.loading;
  }

  /** The device's history recipient id per backend; tails are keyed by it,
   * so a re-keyed device never reads entries it cannot decrypt. */
  setRecipientResolver(resolve: (backendId: string) => Promise<string | undefined>): void { this.recipientFor = resolve; }

  isEnabled(): boolean {
    void this.loaded;
    return this.enabled;
  }

  /** Settings UI: notified when the switch or the stored data change. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.loaded;
    this.enabled = enabled;
    await this.settings.set(this.settingsKey, { enabled });
    if (!enabled) await this.clearAll();
    this.changed();
  }

  /** Records wire events of a conversation. Without `start`, only a
   * conversation already being captured (opened, or read from the cache) is
   * extended, so a tail always begins with a full history window, unless the
   * events start the journal (a conversation created here). */
  capture(backendId: string, conversationId: string, events: readonly HistoryWireEvent[], frames: unknown, options: { start?: boolean } = {}): void {
    if (!this.enabled || !backendId || !conversationId || !events.length) return;
    const key = bufferKey(backendId, conversationId);
    if (this.plaintext.has(key)) return;
    if (events.some((event) => !isHistoryEncryptedPayload(event.payload))) {
      // Plaintext never reaches the disk.
      this.plaintext.add(key);
      this.dropBuffer(key);
      void this.forgetConversation(backendId, conversationId);
      return;
    }
    let buffer = this.buffers.get(key);
    if (!buffer) {
      if (!options.start && !events.some((event) => sequenceOf(event) === 1)) return;
      buffer = this.createBuffer(key, backendId, conversationId);
    }
    for (const event of events) {
      const sequence = sequenceOf(event);
      if (sequence) buffer.events.set(sequence, cachedEvent(event));
    }
    if (frames && typeof frames === 'object') Object.assign(buffer.frames, frames);
    this.keepContiguousTail(buffer);
    buffer.dirty = true;
    buffer.touchedAt = this.now();
    this.schedule(key, buffer);
  }

  private createBuffer(key: string, backendId: string, conversationId: string): Buffer {
    if (this.buffers.size >= MAX_BUFFERS) {
      const oldest = [...this.buffers.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
      if (oldest) {
        const [oldestKey] = oldest;
        void this.flush(oldestKey).finally(() => this.dropBuffer(oldestKey));
      }
    }
    const buffer: Buffer = { backendId, conversationId, events: new Map(), frames: {}, dirty: false, touchedAt: this.now(), timer: null };
    this.buffers.set(key, buffer);
    return buffer;
  }

  /** Keeps the newest run of consecutive sequences, at most one window. */
  private keepContiguousTail(buffer: Buffer): void {
    const newest = Math.max(...buffer.events.keys());
    let oldest = newest;
    while (newest - oldest + 1 < HISTORY_CACHE_TAIL_EVENTS && buffer.events.has(oldest - 1)) oldest -= 1;
    for (const sequence of buffer.events.keys()) if (sequence < oldest) buffer.events.delete(sequence);
  }

  private schedule(key: string, buffer: Buffer): void {
    if (buffer.timer) clearTimeout(buffer.timer);
    buffer.timer = setTimeout(() => {
      buffer.timer = null;
      void this.flush(key);
    }, HISTORY_CACHE_FLUSH_DELAY_MS);
  }

  private dropBuffer(key: string): void {
    const buffer = this.buffers.get(key);
    if (buffer?.timer) clearTimeout(buffer.timer);
    this.buffers.delete(key);
  }

  /** Writes every changed tail now (conversation switch, window hidden). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.buffers.keys()].map((key) => this.flush(key)));
  }

  private async flush(key: string): Promise<void> {
    const buffer = this.buffers.get(key);
    if (!buffer?.dirty) return;
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    await this.loaded;
    const rid = await this.recipientFor(buffer.backendId).catch(() => undefined);
    if (!this.enabled || !rid || !buffer.events.size) return;
    buffer.dirty = false;
    const events = [...buffer.events.entries()].sort((a, b) => a[0] - b[0]).map(([, event]) => event);
    const referenced = new Set(events.flatMap(frameIdsOf));
    const frames: Record<string, unknown> = {};
    for (const id of referenced) if (id in buffer.frames) frames[id] = buffer.frames[id];
    buffer.frames = frames;
    const storeKey = tailKey(buffer.backendId, rid, buffer.conversationId);
    const tail: StoredHistoryTail = { key: storeKey, events, frames };
    const at = this.now();
    const meta: HistoryTailMeta = {
      key: storeKey, backendId: buffer.backendId, rid, conversationId: buffer.conversationId,
      firstSequence: sequenceOf(events[0]), lastSequence: sequenceOf(events[events.length - 1]),
      savedAt: at, usedAt: at, bytes: JSON.stringify(tail).length,
    };
    try {
      await this.store.putTail(tail, meta);
      await this.enforceQuota();
      this.changed();
    } catch (error) {
      buffer.dirty = true;
      warn('write', error);
    }
  }

  private async enforceQuota(): Promise<void> {
    const metas = (await this.store.listTailMeta()).sort((a, b) => b.usedAt - a.usedAt);
    const evicted: string[] = [];
    let bytes = 0;
    metas.forEach((meta, index) => {
      bytes += meta.bytes;
      if (index >= HISTORY_CACHE_MAX_CONVERSATIONS || bytes > HISTORY_CACHE_MAX_BYTES) evicted.push(meta.key);
    });
    await this.store.deleteTails(evicted);
  }

  /** The cached tail of a conversation, which also becomes its capture
   * buffer so later events extend it. `null` when nothing usable is stored
   * or the cache cannot be read. */
  async read(backendId: string, conversationId: string): Promise<CachedHistoryTail | null> {
    await this.loaded;
    const rid = await this.recipientFor(backendId).catch(() => undefined);
    if (!this.enabled || !rid || this.plaintext.has(bufferKey(backendId, conversationId))) return null;
    const key = tailKey(backendId, rid, conversationId);
    try {
      const tail = await this.store.getTail(key);
      if (!tail?.events.length) return null;
      const first = sequenceOf(tail.events[0]);
      const last = sequenceOf(tail.events[tail.events.length - 1]);
      if (!first || last - first + 1 !== tail.events.length) return null;
      const buffer = this.buffers.get(bufferKey(backendId, conversationId))
        ?? this.createBuffer(bufferKey(backendId, conversationId), backendId, conversationId);
      for (const event of tail.events) {
        const sequence = sequenceOf(event);
        if (sequence && !buffer.events.has(sequence)) buffer.events.set(sequence, event);
      }
      buffer.frames = { ...tail.frames, ...buffer.frames };
      this.keepContiguousTail(buffer);
      void this.store.putTailMeta({
        key, backendId, rid, conversationId, firstSequence: first, lastSequence: last,
        savedAt: this.now(), usedAt: this.now(), bytes: JSON.stringify(tail).length,
      }).catch((error: unknown) => warn('touch', error));
      return { events: tail.events, frames: tail.frames };
    } catch (error) {
      warn('read', error);
      return null;
    }
  }

  /** Drops a conversation's tail after it disagreed with the journal. */
  async discard(backendId: string, conversationId: string): Promise<void> {
    this.dropBuffer(bufferKey(backendId, conversationId));
    await this.forgetConversation(backendId, conversationId);
  }

  /** A deleted conversation: its tail and wraps go. */
  async forgetConversation(backendId: string, conversationId: string): Promise<void> {
    this.dropBuffer(bufferKey(backendId, conversationId));
    try {
      const metas = await this.store.listTailMeta();
      await this.store.deleteTails(metas.filter((meta) => meta.backendId === backendId && meta.conversationId === conversationId).map((meta) => meta.key));
      const wraps = await this.store.listWrapKeys(backendId);
      await this.store.deleteWraps(wraps.filter((key) => key.split('\u0000')[2] === conversationId));
      this.changed();
    } catch (error) {
      warn('forget conversation', error);
    }
  }

  /** Keeps only conversations the backend still lists. */
  async retainConversations(backendId: string, conversationIds: ReadonlySet<string>): Promise<void> {
    try {
      const metas = await this.store.listTailMeta();
      const gone = [...new Set(metas.filter((meta) => meta.backendId === backendId && !conversationIds.has(meta.conversationId)).map((meta) => meta.conversationId))];
      for (const conversationId of gone) await this.forgetConversation(backendId, conversationId);
    } catch (error) {
      warn('prune', error);
    }
  }

  /** This device was revoked on the backend, re-keyed, or the backend was
   * removed: everything cached for it goes. */
  async forgetBackend(backendId: string): Promise<void> {
    for (const [key, buffer] of [...this.buffers]) if (buffer.backendId === backendId) this.dropBuffer(key);
    try {
      await this.store.deleteBackend(backendId);
      this.changed();
    } catch (error) {
      warn('forget backend', error);
    }
  }

  async clearAll(): Promise<void> {
    for (const key of [...this.buffers.keys()]) this.dropBuffer(key);
    try {
      await this.store.clear();
    } finally {
      this.changed();
    }
  }

  async usage(): Promise<{ conversations: number; bytes: number }> {
    const metas = await this.store.listTailMeta();
    return { conversations: metas.length, bytes: metas.reduce((sum, meta) => sum + meta.bytes, 0) };
  }

  /** Wraps the device's wrap fetcher: wraps already stored answer without a
   * round trip (and offline); fetched ones are stored for the next time. */
  wrapsFetcher(backendId: string, fetch: HistoryWrapsFetcher): HistoryWrapsFetcher {
    return async (request) => {
      if (!this.enabled) return fetch(request);
      const keyOf = (kid: string) => wrapKey(backendId, request.rid, request.conversationId, kid);
      let stored: Record<string, HistoryWrappedKeyJson> = {};
      try {
        stored = await this.store.getWraps(request.kids.map(keyOf));
      } catch (error) {
        warn('read wraps', error);
      }
      const result: Record<string, HistoryWrappedKeyJson> = {};
      const missing: string[] = [];
      for (const kid of request.kids) {
        const wrap = stored[keyOf(kid)];
        if (wrap) result[kid] = wrap;
        else missing.push(kid);
      }
      if (!missing.length) return result;
      const fetched = await fetch({ ...request, kids: missing });
      Object.assign(result, fetched);
      const entries = Object.entries(fetched).map(([kid, wrap]) => ({ key: keyOf(kid), wrap }));
      if (this.enabled && entries.length) void this.store.putWraps(entries).catch((error: unknown) => warn('write wraps', error));
      return result;
    };
  }
}

/** The client's cache, or `null` where the platform keeps none (web). */
export const historyTailCache: HistoryTailCache | null = platform.historyCache
  ? new HistoryTailCache(platform.historyCache, platform.store, `${platform.storagePrefix}.historyCache.v1`)
  : null;

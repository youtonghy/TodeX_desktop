import { adoptConversationRuntimeTurn, applyConversationRuntimeEvents, createConversationRuntime, hydrateConversationRuntimeEvents, prependConversationRuntimeEvents, type ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { t } from '../i18n';
import { canonicalConversationEventType } from '@todex/protocol/v2';
import type { ConversationEvent, ConversationReplay } from '@todex/protocol/v2';

type Replay = (conversationId: string, afterSequence: number, limit: number) => Promise<ConversationReplay>;
type ReplayBefore = (conversationId: string, beforeSequence: number, limit: number) => Promise<ConversationReplay>;
/** `recovering` marks a batch that may include history; `live` lists the
 * applied sequences that arrived as realtime frames and are new either way. */
type Update = (state: ConversationRuntime, applied: ConversationEvent[], recovering: boolean, live: ReadonlySet<number>) => void;

/** History pages arrive in bursts; merging their notifications into one
 * update per interval keeps rendering and list ordering stable. */
const NOTIFY_INTERVAL_MS = 60;
/** Events fetched per history window when lazily opening a conversation or
 * paging backwards on scroll. */
const HISTORY_PAGE_LIMIT = 300;
/** A still-running turn's start can sit far below the tail; bound the pages
 * that project so opening stays fast. Further back the start is only
 * searched for, not projected. */
const TURN_START_SCAN_MAX_PAGES = 10;
/** Events per fetch-only page while searching for a turn boundary (the
 * backend caps pages at 1000). */
const TURN_BOUNDARY_PAGE_LIMIT = 1000;
/** Events that settle the turn state on their own, without earlier history. */
const TURN_LIFECYCLE_TYPES = new Set(['turn.started', 'turn.completed', 'turn.cancelled', 'turn.interrupted', 'turn.failed']);
const NO_LIVE: ReadonlySet<number> = new Set();

const isTurnLifecycle = (event: ConversationEvent) => TURN_LIFECYCLE_TYPES.has(canonicalConversationEventType(event));

/** The newest lifecycle event of an ascending page: its `turn.started` when
 * that turn is still open, `null` when the newest one settled a turn, and
 * `undefined` when the page holds none. */
function newestTurnBoundary(events: readonly ConversationEvent[]): ConversationEvent | null | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (isTurnLifecycle(event)) return canonicalConversationEventType(event) === 'turn.started' ? event : null;
  }
  return undefined;
}

/** Outcome of one earlier-history request. `failed` pages stay unloaded and
 * are only retried on an explicit request. */
export type EarlierHistoryResult = { hasMore: boolean; failed?: boolean };

export type ConversationOpenOptions = {
  /** Journal high-water mark from the conversation manifest. */
  highWater: number;
  /** The manifest still reports an active turn: page back to its start. */
  turnActive?: boolean;
  /** Events per backward page; defaults to HISTORY_PAGE_LIMIT. */
  pageLimit?: number;
};

/** One projection is shared by REST pages and live frames. A late history
 * response can fill a gap, but can never replace newer applied state. */
export class ConversationRecovery {
  private readonly states = new Map<string, ConversationRuntime>();
  private readonly recovering = new Map<string, Promise<void>>();
  private readonly incomplete = new Set<string>();
  /** Lazy-loading cursor: events at or below the floor stay unfetched. A
   * conversation without an entry was fully replayed. */
  private readonly historyFloors = new Map<string, number>();
  private readonly historyLoading = new Map<string, Promise<EarlierHistoryResult>>();
  private readonly pendingNotify = new Map<string, { applied: ConversationEvent[]; recovering: boolean; live: Set<number> }>();
  /** Realtime frames not projected yet (buffered above a gap); they stay
   * marked live until they apply, even when a history page drains them. */
  private readonly liveSequences = new Map<string, Set<number>>();
  /** Lazily loaded conversations whose turn state is known although history
   * below the floor is unloaded: a lifecycle event projected, or a boundary
   * search settled it. */
  private readonly turnResolved = new Set<string>();
  private readonly turnScans = new Map<string, Promise<void>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;

  constructor(
    private readonly replay: Replay,
    private readonly update: Update,
    private readonly onError: (message: string) => void,
    private readonly replayBefore?: ReplayBefore,
  ) {}

  get(conversationId: string): ConversationRuntime | undefined { return this.states.get(conversationId); }
  isRecovering(conversationId: string): boolean { return this.recovering.has(conversationId) || this.incomplete.has(conversationId); }
  /** Older journal pages remain unfetched. */
  hasEarlierHistory(conversationId: string): boolean { return (this.historyFloors.get(conversationId) ?? 0) > 0; }
  isLoadingEarlier(conversationId: string): boolean { return this.historyLoading.has(conversationId); }

  reset(): void {
    this.epoch++;
    this.states.clear();
    this.incomplete.clear();
    this.recovering.clear();
    this.historyFloors.clear();
    this.historyLoading.clear();
    this.pendingNotify.clear();
    this.liveSequences.clear();
    this.turnResolved.clear();
    this.turnScans.clear();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Drop a loaded conversation so its next open pages in lazily from the
   * journal tail again. Refused while a replay or history page is in flight. */
  release(conversationId: string): boolean {
    if (this.recovering.has(conversationId) || this.historyLoading.has(conversationId) || this.turnScans.has(conversationId)) return false;
    this.states.delete(conversationId);
    this.historyFloors.delete(conversationId);
    this.incomplete.delete(conversationId);
    this.pendingNotify.delete(conversationId);
    this.liveSequences.delete(conversationId);
    this.turnResolved.delete(conversationId);
    return true;
  }

  private queueUpdate(conversationId: string, applied: ConversationEvent[], recovering: boolean, live: ReadonlySet<number>): void {
    const pending = this.pendingNotify.get(conversationId);
    if (pending) {
      pending.applied.push(...applied);
      pending.recovering ||= recovering;
      for (const sequence of live) pending.live.add(sequence);
    } else {
      this.pendingNotify.set(conversationId, { applied: [...applied], recovering, live: new Set(live) });
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushUpdates(), NOTIFY_INTERVAL_MS);
    }
  }

  /** Delivered updates during recovery are isolated: a consumer failure is
   * reported through onError instead of aborting the replay loop. */
  private deliver(conversationId: string, applied: ConversationEvent[], recovering: boolean, live: ReadonlySet<number> = NO_LIVE): void {
    const state = this.states.get(conversationId);
    if (!state) return;
    try {
      this.update(state, applied, this.isRecovering(conversationId) || recovering, live);
    } catch (error) {
      this.onError(error instanceof Error ? error.message : t('rec.submitFailed'));
    }
  }

  private flushConversation(conversationId: string): void {
    const pending = this.pendingNotify.get(conversationId);
    if (!pending) return;
    this.pendingNotify.delete(conversationId);
    this.deliver(conversationId, pending.applied, pending.recovering, pending.live);
  }

  private flushUpdates(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.pendingNotify.size) return;
    const pending = [...this.pendingNotify.keys()];
    for (const conversationId of pending) {
      this.flushConversation(conversationId);
    }
  }

  /** Insert a runtime whose cursor starts at `floor`: events at or below it
   * are treated as intentionally unloaded history. A state a racing live
   * frame already created keeps its buffered events so nothing is lost. */
  private seed(conversationId: string, workspaceId: string, floor: number): void {
    const floorSequence = Math.max(0, floor);
    const existing = this.states.get(conversationId);
    if (existing && existing.appliedSequence > 0) {
      this.historyFloors.set(conversationId, Math.min(floorSequence, this.historyFloors.get(conversationId) ?? floorSequence));
      return;
    }
    const seeded = createConversationRuntime(conversationId, workspaceId, floorSequence);
    if (existing) {
      for (const event of Object.values(existing.pendingEvents)) {
        if (event.sequence > floorSequence) seeded.pendingEvents[event.sequence] = event;
      }
      seeded.highWaterSequence = existing.highWaterSequence;
    }
    this.states.set(conversationId, seeded);
    this.historyFloors.set(conversationId, floorSequence);
    this.turnResolved.delete(conversationId);
  }

  /** Merge full events fetched on demand into a summary-replayed runtime.
   * Only folded step entries merge back; hydration never rewinds cursors. */
  hydrate(conversationId: string, _workspaceId: string, events: readonly ConversationEvent[]): boolean {
    // Hydration merges into the committed runtime only; fabricating one from a
    // partial range would replace the rendered timeline with group contents.
    const state = this.states.get(conversationId);
    if (!state) return false;
    const next = hydrateConversationRuntimeEvents(state, events);
    if (next === state) return false;
    this.states.set(conversationId, next);
    this.deliver(conversationId, [], this.isRecovering(conversationId));
    return true;
  }

  /** Apply realtime frames from the socket. */
  receive(conversationId: string, workspaceId: string, events: readonly ConversationEvent[]): void {
    if (!this.states.has(conversationId) && !this.recovering.has(conversationId)) {
      // A live event for a conversation that was never opened: everything
      // below it is unloaded history, not a gap. Seeding a lazy floor keeps
      // background activity from replaying the whole journal; the history
      // pages in when the conversation is actually opened and scrolled.
      const first = Math.min(...events.map((event) => event.sequence).filter((sequence) => Number.isFinite(sequence) && sequence > 0));
      if (Number.isFinite(first) && first > 1) {
        // A mid-turn frame (e.g. a delta after a reconnect) says nothing about
        // whether its turn is still running: that lives in the turn.started
        // below the floor. Page back to it so the runtime projects the running
        // turn instead of an idle one with no stop control. The frames buffer
        // above the gap until the window lands.
        if (this.replayBefore && !events.some(isTurnLifecycle)) {
          void this.open(conversationId, workspaceId, { highWater: first - 1, turnActive: true });
        } else {
          this.seed(conversationId, workspaceId, first - 1);
        }
      }
    }
    this.ingest(conversationId, workspaceId, events, true);
  }

  /** Project events into the committed runtime; `live` marks realtime frames
   * as opposed to history pages. */
  private ingest(conversationId: string, workspaceId: string, events: readonly ConversationEvent[], live: boolean): void {
    const committed = this.states.get(conversationId);
    const previous = committed ?? createConversationRuntime(conversationId, workspaceId);
    if (live) {
      const marks = this.liveSequences.get(conversationId) ?? new Set<number>();
      for (const event of events) if (event.sequence > previous.appliedSequence) marks.add(event.sequence);
      if (marks.size) this.liveSequences.set(conversationId, marks);
    }
    const result = applyConversationRuntimeEvents(previous, events);
    if (result.state === previous && committed) return;
    const liveApplied = this.takeLive(conversationId, result.appliedEvents, result.state.appliedSequence);
    const recovering = this.isRecovering(conversationId) || result.missingSequences.length > 0;
    // The state commits before the consumer runs so callbacks observing
    // get() see the latest projection.
    this.states.set(conversationId, result.state);
    if (result.appliedEvents.some(isTurnLifecycle)) this.turnResolved.add(conversationId);
    if (this.recovering.has(conversationId)) {
      // Inside a recovery pass the consumer is only notified once per
      // interval (and once at the end).
      this.queueUpdate(conversationId, result.appliedEvents, recovering, liveApplied);
    } else {
      // Live frames keep the synchronous contract: a throwing consumer
      // rolls the commit back.
      try {
        this.update(result.state, result.appliedEvents, recovering, liveApplied);
      } catch (error) {
        if (this.states.get(conversationId) === result.state) {
          if (committed) this.states.set(conversationId, committed);
          else this.states.delete(conversationId);
        }
        throw error;
      }
    }
    if (result.missingSequences.length && !this.recovering.has(conversationId)) {
      void this.recover(conversationId, workspaceId);
    }
  }

  /** Split the applied realtime frames off the live marks; marks at or below
   * the cursor that never applied (duplicates, skipped floors) are dropped. */
  private takeLive(conversationId: string, applied: readonly ConversationEvent[], appliedSequence: number): ReadonlySet<number> {
    const marks = this.liveSequences.get(conversationId);
    if (!marks) return NO_LIVE;
    const live = new Set<number>();
    for (const event of applied) if (marks.delete(event.sequence)) live.add(event.sequence);
    for (const sequence of marks) if (sequence <= appliedSequence) marks.delete(sequence);
    if (!marks.size) this.liveSequences.delete(conversationId);
    return live;
  }

  /** Lazy history open: seeds a floor near the journal tail so only the
   * newest window projects, then applies it through the normal receive path.
   * An active turn's start is paged in (bounded) so live status still
   * projects; beyond that bound it is searched for by `resolveTurn` once the
   * window rendered. Falls back to the full forward replay when the backend
   * lacks reverse paging or the runtime is already initialized. */
  open(conversationId: string, workspaceId: string, options: ConversationOpenOptions): Promise<void> {
    const existing = this.recovering.get(conversationId);
    if (existing) return existing;
    const epoch = this.epoch;
    let bufferedFramesSeeded = false;
    const work = Promise.resolve().then(async () => {
      const committed = this.states.get(conversationId);
      const initialized = this.historyFloors.has(conversationId) || Boolean(committed && committed.appliedSequence > 0);
      if (initialized || !this.replayBefore || options.highWater <= 0) {
        await this.replayForward(conversationId, workspaceId, epoch);
        return;
      }
      // Collect backward pages first so the floor is seeded exactly once and
      // every event applies exactly once through receive.
      const pages: ConversationEvent[][] = [];
      let cursor = options.highWater;
      let hasMore = true;
      const pageLimit = options.pageLimit ?? HISTORY_PAGE_LIMIT;
      const maxPages = options.turnActive ? TURN_START_SCAN_MAX_PAGES : 1;
      for (let count = 0; count < maxPages && cursor > 0; count++) {
        const page = await this.replayBefore(conversationId, cursor, pageLimit);
        if (epoch !== this.epoch) return;
        const last = page.events[page.events.length - 1];
        if (last && last.sequence !== cursor) {
          // A backend without reverse paging answers a forward page instead;
          // abort the lazy path and replay the whole journal.
          await this.replayForward(conversationId, workspaceId, epoch);
          return;
        }
        if (!page.events.length) { hasMore = false; cursor = 0; break; }
        pages.unshift(page.events);
        hasMore = page.hasMore;
        cursor = page.events[0].sequence - 1;
        if (!hasMore) break;
        if (!options.turnActive || pages.some((events) => events.some(isTurnLifecycle))) break;
      }
      this.seed(conversationId, workspaceId, hasMore ? cursor : 0);
      for (const events of pages) this.ingest(conversationId, workspaceId, events, false);
      // Live events that landed while the window was fetched leave a gap
      // above the collected pages; close it with the forward cursor.
      const state = this.states.get(conversationId);
      if (state && state.appliedSequence < state.highWaterSequence) {
        await this.replayForward(conversationId, workspaceId, epoch);
      }
      this.incomplete.delete(conversationId);
    }).catch((error: unknown) => {
      if (epoch !== this.epoch) return;
      // Realtime frames buffered for a window that never landed still project
      // from their own floor; replaying the whole journal to place them would
      // cost far more than the history this open was meant to skip.
      bufferedFramesSeeded = this.seedBufferedFrames(conversationId, workspaceId);
      if (!bufferedFramesSeeded) this.incomplete.add(conversationId);
      this.onError(error instanceof Error ? error.message : t('rec.recoveryFailed'));
    }).finally(() => {
      if (epoch !== this.epoch) return;
      this.recovering.delete(conversationId);
      this.flushConversation(conversationId);
      const state = this.states.get(conversationId);
      if (state) this.update(state, [], this.isRecovering(conversationId), NO_LIVE);
      if (!state) return;
      if (bufferedFramesSeeded) {
        // The frames project from their own floor but may still sit above a
        // gap between them; close it forward from there.
        if (state.appliedSequence < state.highWaterSequence) void this.recover(conversationId, workspaceId);
      } else if (options.turnActive) {
        // Past the projected window the running turn's start is searched for
        // without holding the conversation in recovery.
        void this.resolveTurn(conversationId);
      }
    });
    this.recovering.set(conversationId, work);
    const state = this.states.get(conversationId);
    if (state) this.update(state, [], true, NO_LIVE);
    return work;
  }

  /** A lazy open that failed before seeding leaves its realtime frames
   * buffered above sequence 0. Seed the floor right below the oldest so they
   * project; the turn state stays unresolved for `resolveTurn` to retry. */
  private seedBufferedFrames(conversationId: string, workspaceId: string): boolean {
    const state = this.states.get(conversationId);
    if (!state || state.appliedSequence > 0 || this.historyFloors.has(conversationId)) return false;
    const buffered = Object.values(state.pendingEvents);
    if (!buffered.length) return false;
    const first = Math.min(...buffered.map((event) => event.sequence));
    this.states.delete(conversationId);
    this.seed(conversationId, workspaceId, first - 1);
    this.ingest(conversationId, workspaceId, buffered, false);
    return true;
  }

  /** Page back from `cursor` without projecting until the newest turn
   * lifecycle event. Returns the still-open turn's `turn.started`, `null`
   * when no turn is running (or the backend cannot page backwards), and
   * `undefined` when a backend switch made the answer stale. Unbounded on
   * purpose: it only reads, and stops at the current turn's boundary. */
  private async findTurnBoundary(conversationId: string, cursor: number, epoch: number): Promise<ConversationEvent | null | undefined> {
    const replayBefore = this.replayBefore;
    if (!replayBefore) return null;
    for (let next = cursor; next > 0;) {
      const page = await replayBefore(conversationId, next, TURN_BOUNDARY_PAGE_LIMIT);
      if (epoch !== this.epoch) return undefined;
      const oldest = page.events[0]?.sequence ?? 0;
      const newest = page.events[page.events.length - 1]?.sequence ?? 0;
      if (newest > next) return null;
      const boundary = newestTurnBoundary(page.events);
      if (boundary !== undefined) return boundary;
      if (!page.hasMore || oldest <= 1) return null;
      next = oldest - 1;
    }
    return null;
  }

  /** Adopt the running turn of a lazy window that never projected a lifecycle
   * event, searching below its floor. */
  private async resolveTurnBoundary(conversationId: string, epoch: number): Promise<void> {
    const floor = this.historyFloors.get(conversationId) ?? 0;
    const state = this.states.get(conversationId);
    if (!state || floor <= 0 || state.activeTurnId || this.turnResolved.has(conversationId)) return;
    const started = await this.findTurnBoundary(conversationId, floor, epoch);
    // A lifecycle frame that projected meanwhile is newer than anything below
    // the floor and already settled the turn.
    if (started === undefined || this.turnResolved.has(conversationId)) return;
    const current = this.states.get(conversationId);
    if (!current) return;
    this.turnResolved.add(conversationId);
    if (!started) return;
    const next = adoptConversationRuntimeTurn(current, started);
    if (next === current) return;
    this.states.set(conversationId, next);
    this.deliver(conversationId, [], false);
  }

  /** The backend reports a running turn: make sure a lazily loaded projection
   * that never saw the turn start (it lies below the loaded window, or an
   * earlier search failed) adopts it. Single-flight; a no-op once the turn
   * state is known or while a replay owns the conversation. */
  resolveTurn(conversationId: string): Promise<void> {
    const existing = this.turnScans.get(conversationId);
    if (existing) return existing;
    if (this.recovering.has(conversationId) || this.turnResolved.has(conversationId)) return Promise.resolve();
    const epoch = this.epoch;
    const work: Promise<void> = this.resolveTurnBoundary(conversationId, epoch).catch((error: unknown) => {
      if (epoch === this.epoch) this.onError(error instanceof Error ? error.message : t('rec.recoveryFailed'));
    }).finally(() => {
      if (this.turnScans.get(conversationId) === work) this.turnScans.delete(conversationId);
    });
    this.turnScans.set(conversationId, work);
    return work;
  }

  /** Prepend the next older history page into the projected timeline.
   * Resolves whether even earlier events remain and whether this page
   * failed; a failure is also reported through onError. Single-flight per
   * conversation; resolves no more history until `open` seeded a floor
   * above zero. */
  loadEarlier(conversationId: string, _workspaceId: string, limit = HISTORY_PAGE_LIMIT): Promise<EarlierHistoryResult> {
    const inflight = this.historyLoading.get(conversationId);
    if (inflight) return inflight;
    const replayBefore = this.replayBefore;
    const floor = this.historyFloors.get(conversationId) ?? 0;
    if (!replayBefore || floor <= 0 || !this.states.has(conversationId)) {
      return Promise.resolve({ hasMore: false });
    }
    const epoch = this.epoch;
    const work = (async (): Promise<EarlierHistoryResult> => {
      const page = await replayBefore(conversationId, floor, limit);
      if (epoch !== this.epoch) return { hasMore: this.hasEarlierHistory(conversationId) };
      // Only events below the floor are history; the window above it is
      // already projected and would otherwise merge twice.
      const events = page.events.filter((event) => event.sequence <= floor);
      if (!events.length) {
        this.historyFloors.set(conversationId, 0);
        return { hasMore: false };
      }
      const state = this.states.get(conversationId);
      if (state) {
        let next = prependConversationRuntimeEvents(state, events);
        // Prepended rows never project turn state, so an unresolved window
        // takes it from the page's newest lifecycle event here; a later
        // boundary search then starts below this page.
        const boundary = this.turnResolved.has(conversationId) ? undefined : newestTurnBoundary(events);
        if (boundary !== undefined) {
          this.turnResolved.add(conversationId);
          if (boundary) next = adoptConversationRuntimeTurn(next, boundary);
        }
        if (next !== state) {
          this.states.set(conversationId, next);
          this.deliver(conversationId, [], this.isRecovering(conversationId));
        }
      }
      const first = events[0].sequence;
      this.historyFloors.set(conversationId, first - 1);
      return { hasMore: page.hasMore && first > 1 };
    })().catch((error: unknown): EarlierHistoryResult => {
      if (epoch !== this.epoch) return { hasMore: this.hasEarlierHistory(conversationId) };
      this.onError(error instanceof Error ? error.message : t('rec.loadEarlierFailed'));
      return { hasMore: this.hasEarlierHistory(conversationId), failed: true };
    }).finally(() => {
      if (epoch === this.epoch) this.historyLoading.delete(conversationId);
    });
    this.historyLoading.set(conversationId, work);
    return work;
  }

  recover(conversationId: string, workspaceId: string): Promise<void> {
    const existing = this.recovering.get(conversationId);
    if (existing) return existing;
    const epoch = this.epoch;
    // Defer work until the single-flight entry exists, including synchronous
    // replay mocks. This also suppresses stale approval prompts during replay.
    const work = Promise.resolve().then(() => this.replayForward(conversationId, workspaceId, epoch)).catch((error: unknown) => {
      if (epoch === this.epoch) {
        this.incomplete.add(conversationId);
        this.onError(error instanceof Error ? error.message : t('rec.recoveryFailed'));
      }
    }).finally(() => {
      if (epoch !== this.epoch) return;
      this.recovering.delete(conversationId);
      this.flushConversation(conversationId);
      const state = this.states.get(conversationId);
      if (state) this.update(state, [], this.isRecovering(conversationId), NO_LIVE);
    });
    this.recovering.set(conversationId, work);
    const state = this.states.get(conversationId);
    if (state) this.update(state, [], true, NO_LIVE);
    return work;
  }

  private async replayForward(conversationId: string, workspaceId: string, epoch: number): Promise<void> {
    let cursor = this.states.get(conversationId)?.appliedSequence ?? 0;
    let pages = 0;
    for (;;) {
      const page = await this.replay(conversationId, cursor, 500);
      if (epoch !== this.epoch) return;
      this.ingest(conversationId, workspaceId, page.events, false);
      const state = this.states.get(conversationId)!;
      const next = state.appliedSequence;
      const missing = next < state.highWaterSequence;
      if (!page.hasMore && !missing) {
        this.incomplete.delete(conversationId);
        return;
      }
      if (next <= cursor || ++pages >= 10_000) {
        throw new Error(t('rec.gapError'));
      }
      cursor = next;
    }
  }
}

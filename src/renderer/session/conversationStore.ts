// The session's high-frequency state outside React: the timeline every
// conversation projects into, the conversation runtimes and the sent
// attachment receipts the timeline shows. A streamed delta writes here
// without re-rendering the app; components subscribe to the slice they
// render (`useConversationTimeline`, `useConversationRuntime`, …) and
// re-render only when it changes.
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { createStore, useStoreSelector, type Store } from './store/createStore';
import type { TimelineEntry } from './helpers';
import { projectSentAttachments, type SentAttachmentRecord } from './sentAttachments';

export type ConversationStores = {
  /** Every conversation's rows, newest first (runtime projections and local rows). */
  timeline: Store<TimelineEntry[]>;
  /** Runtime per local conversation id. */
  runtime: Store<Record<string, ConversationRuntime>>;
  sentAttachments: Store<SentAttachmentRecord[]>;
};

type Projection = { records: SentAttachmentRecord[]; projected: TimelineEntry };

/** One set per session hook instance. */
export function createConversationStores(): ConversationStores {
  return {
    timeline: createStore<TimelineEntry[]>([]),
    runtime: createStore<Record<string, ConversationRuntime>>({}),
    sentAttachments: createStore<SentAttachmentRecord[]>([]),
  };
}

const projections = new WeakMap<TimelineEntry, Projection>();
const visibleCache = new WeakMap<ConversationStores, { timeline: TimelineEntry[]; records: SentAttachmentRecord[]; visible: TimelineEntry[] }>();

/** An outgoing row with the attachments sent with it; each row is projected
 * once per records version and keeps its identity otherwise. */
function projectRow(entry: TimelineEntry, records: SentAttachmentRecord[]): TimelineEntry {
  if (entry.kind !== 'outgoing') return entry;
  const hit = projections.get(entry);
  if (hit?.records === records) return hit.projected;
  const projected = projectSentAttachments([entry], records, entry.conversationId ?? '')[0];
  projections.set(entry, { records, projected });
  return projected;
}

/** The timeline as shown (attachments bound to their rows). */
export function visibleTimeline(stores: ConversationStores): TimelineEntry[] {
  const timeline = stores.timeline.get();
  const records = stores.sentAttachments.get();
  const cached = visibleCache.get(stores);
  if (cached && cached.timeline === timeline && cached.records === records) return cached.visible;
  const visible = timeline.map((entry) => projectRow(entry, records));
  visibleCache.set(stores, { timeline, records, visible });
  return visible;
}

/** Same keys and, per key, equal values (identity unless `equal` is given). */
export function sameRecordValues<Value>(left: Record<string, Value>, right: Record<string, Value>, equal: (a: Value, b: Value) => boolean = Object.is): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && equal(left[key], right[key]));
}

function sameRows(left: readonly TimelineEntry[], right: readonly TimelineEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

/** Re-renders when the selected slice of the visible timeline changes; a
 * receipts change re-renders too, and the slice is then taken again. */
function useVisibleSource<Slice>(stores: ConversationStores, select: (visible: TimelineEntry[]) => Slice, isEqual?: (left: Slice, right: Slice) => boolean): Slice {
  useStoreSelector(stores.sentAttachments, (records) => records);
  return useStoreSelector(stores.timeline, () => select(visibleTimeline(stores)), isEqual);
}

/** Every visible row; re-renders on any timeline change. */
export function useVisibleTimeline(stores: ConversationStores): TimelineEntry[] {
  return useVisibleSource(stores, (visible) => visible);
}

/** A derived value of the visible timeline that re-renders only when
 * `isEqual` says it changed. */
export function useTimelineSelector<Slice>(stores: ConversationStores, select: (visible: TimelineEntry[]) => Slice, isEqual: (left: Slice, right: Slice) => boolean): Slice {
  return useVisibleSource(stores, select, isEqual);
}

/** One conversation's rows; another conversation's events do not re-render it. */
export function useConversationTimeline(stores: ConversationStores, conversationId: string | undefined): TimelineEntry[] {
  return useVisibleSource(stores, (visible) => (conversationId ? visible.filter((entry) => entry.conversationId === conversationId) : []), sameRows);
}

export function useConversationRuntime(stores: ConversationStores, conversationId: string | undefined): ConversationRuntime | undefined {
  return useStoreSelector(stores.runtime, (runtimes) => (conversationId ? runtimes[conversationId] : undefined));
}

/** A derived value of every runtime that re-renders only when `isEqual`
 * says it changed (identity by default). */
export function useRuntimeSelector<Slice>(stores: ConversationStores, select: (runtimes: Record<string, ConversationRuntime>) => Slice, isEqual?: (left: Slice, right: Slice) => boolean): Slice {
  return useStoreSelector(stores.runtime, select, isEqual);
}

import { isStepProgressEntry, type TimelineEntry } from '@todex/protocol/mobileParity';

/** Both clients render semantic errors and tools from the same projection. */
export function isChatTimelineEntry(entry: TimelineEntry): boolean {
  return entry.kind !== 'system' || isStepProgressEntry(entry) || entry.category === 'error'
    || entry.title === 'turn.failed';
}

export function isChatToolEntry(entry: TimelineEntry): boolean {
  return entry.category ? entry.category === 'tool' : entry.kind === 'system' && entry.title === '工具调用';
}

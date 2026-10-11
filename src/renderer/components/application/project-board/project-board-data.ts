import type { WorkspaceRecord } from '@todex/protocol/todex';
import { getConversationStatus, type ConversationRecord, type TimelineEntry } from '@/session/helpers';
import {
  kanbanTaskConversationIds,
  kanbanTaskStatuses,
  type KanbanTask,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
} from '@/session/kanbanTasks';
import type { TodeXSession } from '@/session/useTodeXSession';

/**
 * Data side of the task board (BoardUI project-board template, driven by the
 * TodeX kanban store). Columns are task statuses; inside a column, tasks follow
 * the sidebar workspace order, then their manual order within the workspace.
 */

export type BoardColumn = { id: KanbanTaskStatus; tasks: KanbanTask[] };
export type BoardSort = 'manual' | 'priority' | 'title' | 'due';
export type WorkspaceTasks = { workspace: WorkspaceRecord; tasks: KanbanTask[] };

export type LatestEntries = Record<string, { latest: TimelineEntry | undefined; latestIncomingAt: number }>;
export type ConversationGroupKind = 'working' | 'issue' | 'unread' | 'plain' | 'stale';
export type LinkedConversation = { conversation: ConversationRecord; status: ConversationGroupKind; label: string };

export const CONVERSATION_GROUP_ORDER: ConversationGroupKind[] = ['working', 'issue', 'unread', 'plain', 'stale'];

export const CONVERSATION_GROUP_DOT: Record<ConversationGroupKind, string> = {
  working: 'bg-chart-7',
  issue: 'bg-chart-8',
  unread: 'bg-chart-6',
  plain: 'bg-foreground-icon-quaternary',
  stale: 'bg-foreground-icon-quaternary',
};

/** Chip color per priority (low → urgent), as on the BoardUI project board. */
export const PRIORITY_CHIP_COLOR: Record<KanbanTaskPriority, 'blue' | 'yellow' | 'orange' | 'rose'> = {
  low: 'blue',
  medium: 'yellow',
  high: 'orange',
  urgent: 'rose',
};

/** Flag color per priority in pickers (the chip's text color). */
export const PRIORITY_FLAG_CLASS: Record<KanbanTaskPriority, string> = {
  low: 'text-status-blue-text',
  medium: 'text-status-yellow-text',
  high: 'text-status-orange-text',
  urgent: 'text-status-rose-text',
};

const PRIORITY_RANK: Record<KanbanTaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Columns in status order, each holding the matching tasks of every
 * workspace in sidebar order (the per-workspace lists arrive sorted). */
export function buildBoardColumns(groups: readonly WorkspaceTasks[], sort: BoardSort): BoardColumn[] {
  return kanbanTaskStatuses.map((status) => {
    const tasks = groups.flatMap((group) => group.tasks.filter((task) => task.status === status));
    if (sort === 'title') tasks.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'priority') tasks.sort((a, b) => (a.priority ? PRIORITY_RANK[a.priority] : 4) - (b.priority ? PRIORITY_RANK[b.priority] : 4));
    else if (sort === 'due') tasks.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
    return { id: status, tasks };
  });
}

/** Task links hold the local id of a conversation started on this device, or
 * the backend id of one started elsewhere (another device, a schedule). */
export function findTaskConversation(conversations: readonly ConversationRecord[], id: string): ConversationRecord | undefined {
  return conversations.find((item) => item.id === id || item.v2ConversationId === id);
}

/** Linked ids worth keeping when clearing stale links: a conversation a
 * schedule just started may not be in the polled conversation list yet. */
export function keptTaskConversationIds(task: KanbanTask, conversations: readonly ConversationRecord[]): string[] {
  const pending = task.schedule?.resultConversationId;
  return kanbanTaskConversationIds(task)
    .filter((id) => id === pending || findTaskConversation(conversations, id));
}

/** The task's linked conversations with their sidebar status, grouped by it. */
export function groupLinkedConversations(
  task: KanbanTask,
  session: TodeXSession,
  conversations: readonly ConversationRecord[],
  latestEntries: LatestEntries,
  plainLabel: string,
  staleLabel: string,
): { groups: { kind: ConversationGroupKind; label: string; items: LinkedConversation[] }[]; staleCount: number; linked: LinkedConversation[] } {
  const done = task.status === 'done';
  const linked: LinkedConversation[] = [];
  let staleCount = 0;
  for (const id of kanbanTaskConversationIds(task)) {
    const conversation = findTaskConversation(conversations, id);
    if (!conversation) {
      staleCount += 1;
      continue;
    }
    const status = done ? null : getConversationStatus(
      session,
      conversation,
      latestEntries[conversation.id]?.latest,
      latestEntries[conversation.id]?.latestIncomingAt,
    );
    linked.push({ conversation, status: status?.kind ?? 'plain', label: status?.label ?? plainLabel });
  }
  const groups = CONVERSATION_GROUP_ORDER
    .map((kind) => ({
      kind,
      label: kind === 'stale' ? staleLabel : kind === 'plain' ? plainLabel : linked.find((item) => item.status === kind)?.label ?? '',
      items: linked.filter((item) => item.status === kind),
    }))
    .filter((group) => group.items.length > 0 || group.kind === 'stale' && staleCount > 0);
  return { groups, staleCount, linked };
}

/** YYYY-MM-DD in local time, for "created" lines. */
export function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

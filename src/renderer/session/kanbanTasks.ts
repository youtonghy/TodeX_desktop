import { useSyncExternalStore } from 'react';
import {
  KANBAN_TASK_PRIORITIES,
  KANBAN_TASK_STATUSES,
  mergeKanbanTasks,
  normalizeKanbanTask,
  parseKanbanSyncResponse,
  parseKanbanTimeZone,
  prepareKanbanSyncPayload,
  type KanbanTask,
  type KanbanTaskPriority,
  type KanbanTaskSchedule,
  type KanbanTaskStatus,
  type KanbanTimeZone,
} from '@todex/protocol/todex';
import { loadJson, saveJson } from '../lib/storage';
import { KANBAN_TASKS_STORAGE_KEY, WORKSPACE_SYNC_DEBOUNCE_MS, backendFetch, readBackendError, type BackendTransportProfile } from './helpers';
import { toast } from '../components/ui/toast';
import { t } from '../i18n';

export type { KanbanTask, KanbanTaskPriority, KanbanTaskSchedule, KanbanTaskStatus, KanbanTimeZone };

export const kanbanTaskStatuses: readonly KanbanTaskStatus[] = KANBAN_TASK_STATUSES;

const kanbanTaskStatusKeys: Record<KanbanTaskStatus, 'kanban.statusPlanned' | 'kanban.statusInProgress' | 'kanban.statusDone'> = {
  planned: 'kanban.statusPlanned',
  'in-progress': 'kanban.statusInProgress',
  done: 'kanban.statusDone',
};

export function kanbanTaskStatusLabel(status: KanbanTaskStatus): string {
  return t(kanbanTaskStatusKeys[status]);
}

export const kanbanTaskPriorities: readonly KanbanTaskPriority[] = KANBAN_TASK_PRIORITIES;

const kanbanTaskPriorityKeys: Record<KanbanTaskPriority, 'kanban.priorityLow' | 'kanban.priorityMedium' | 'kanban.priorityHigh' | 'kanban.priorityUrgent'> = {
  low: 'kanban.priorityLow',
  medium: 'kanban.priorityMedium',
  high: 'kanban.priorityHigh',
  urgent: 'kanban.priorityUrgent',
};

export function kanbanTaskPriorityLabel(priority: KanbanTaskPriority): string {
  return t(kanbanTaskPriorityKeys[priority]);
}

const KANBAN_TASK_TITLE_LIMIT = 200;
const KANBAN_TASK_DESCRIPTION_LIMIT = 2000;
const KANBAN_TASK_LIMIT = 500;
const KANBAN_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type KanbanSyncConfig = BackendTransportProfile & {
  backendConnectionId: string;
};

// `tasks` keeps tombstones so deletions propagate; UI-facing accessors filter them.
let tasks: KanbanTask[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const timeZoneListeners = new Set<() => void>();

/** Sync state of one connected backend; every connected backend syncs the
 * tasks of its own workspaces. */
type KanbanSyncLink = {
  config: KanbanSyncConfig;
  // A 404 marks a backend older than the sync endpoints; stay local-only
  // until the configuration changes instead of retrying every poll cycle.
  supported: boolean;
  pushTimer: ReturnType<typeof setTimeout> | null;
  pushInFlight: boolean;
  pushAgain: boolean;
  // Zone of the backend, which runs schedules in its own local time.
  timeZone: KanbanTimeZone | null;
  // The last refusal shown, so a push retried every poll warns once.
  shownError?: string;
};
const syncLinks = new Map<string, KanbanSyncLink>();
// The backend the UI focuses (its zone is shown), and which backend owns a
// workspace, so tasks without a backend tag sync with their workspace's.
let focusBackendId = '';
let workspaceBackendOf: (workspaceId: string) => string | null = () => null;

function emit() {
  for (const listener of listeners) listener();
}

function ensureLoaded() {
  loading ??= loadJson<unknown>(KANBAN_TASKS_STORAGE_KEY, [])
    .then((value) => {
      if (!Array.isArray(value)) return;
      tasks = value
        .map(normalizeKanbanTask)
        .filter((task): task is KanbanTask => task !== null);
      emit();
    })
    .catch(() => {});
}

function subscribe(listener: () => void) {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function taskBackendId(task: KanbanTask): string {
  return task.backendConnectionId || workspaceBackendOf(task.workspaceId) || focusBackendId;
}

function tasksForConnection(connectionId: string): KanbanTask[] {
  return tasks.filter((task) => taskBackendId(task) === connectionId);
}

function commit(next: KanbanTask[], options?: { push?: boolean }) {
  const cutoff = Date.now() - KANBAN_TOMBSTONE_RETENTION_MS;
  tasks = next.filter((task) => !task.deletedAt || task.deletedAt >= cutoff);
  emit();
  void saveJson(KANBAN_TASKS_STORAGE_KEY, tasks).catch(() => {});
  if (options?.push !== false) scheduleKanbanBackendPush();
}

export function getKanbanTasks(): KanbanTask[] {
  return tasks;
}

export function useKanbanTasks(): KanbanTask[] {
  return useSyncExternalStore(subscribe, getKanbanTasks);
}

function emitTimeZone() {
  for (const listener of timeZoneListeners) listener();
}

function setTimeZone(link: KanbanSyncLink, next: KanbanTimeZone | null) {
  if (link.timeZone?.name === next?.name && link.timeZone?.offsetMinutes === next?.offsetMinutes) return;
  link.timeZone = next;
  emitTimeZone();
}

/** A backend's time zone (the focused backend's by default), or null before
 * its first sync. */
export function useKanbanTimeZone(backendId?: string): KanbanTimeZone | null {
  return useSyncExternalStore((listener) => {
    timeZoneListeners.add(listener);
    return () => { timeZoneListeners.delete(listener); };
  }, () => syncLinks.get(backendId || focusBackendId)?.timeZone ?? null);
}

/** The focused backend and how workspaces map to backends. */
export function configureKanbanRouting(focusId: string, workspaceBackend: (workspaceId: string) => string | null): void {
  workspaceBackendOf = workspaceBackend;
  if (focusBackendId === focusId) return;
  focusBackendId = focusId;
  emitTimeZone();
}

/** Starts (or, with null, stops) syncing one backend's tasks. */
export function configureKanbanSync(backendConnectionId: string, config: BackendTransportProfile | null): void {
  const previous = syncLinks.get(backendConnectionId);
  if (!config) {
    if (previous?.pushTimer) clearTimeout(previous.pushTimer);
    syncLinks.delete(backendConnectionId);
    emitTimeZone();
    return;
  }
  const next: KanbanSyncConfig = {
    serverUrl: config.serverUrl,
    deviceSecret: config.deviceSecret,
    encryptionProtocol: config.encryptionProtocol,
    encryptionPublicKey: config.encryptionPublicKey,
    transportVerified: config.transportVerified,
    backendConnectionId,
  };
  const changed = !previous
    || previous.config.serverUrl !== next.serverUrl
    || previous.config.deviceSecret !== next.deviceSecret
    || previous.config.encryptionProtocol !== next.encryptionProtocol
    || previous.config.encryptionPublicKey !== next.encryptionPublicKey
    || previous.config.transportVerified !== next.transportVerified;
  if (!changed) return;
  if (previous?.pushTimer) clearTimeout(previous.pushTimer);
  syncLinks.set(backendConnectionId, { config: next, supported: true, pushTimer: null, pushInFlight: false, pushAgain: false, timeZone: null });
  emitTimeZone();
  void syncKanbanTasksFromBackend(backendConnectionId);
}

/** Pulls one backend's tasks (or every connected backend's). */
export async function syncKanbanTasksFromBackend(backendConnectionId?: string): Promise<void> {
  if (backendConnectionId === undefined) {
    await Promise.all([...syncLinks.keys()].map((id) => syncKanbanTasksFromBackend(id)));
    return;
  }
  const link = syncLinks.get(backendConnectionId);
  if (!link?.supported) return;
  try {
    const response = await backendFetch(link.config, {
      method: 'GET',
      path: '/v2/kanban/tasks',
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) {
      link.supported = false;
      return;
    }
    if (!response.ok) {
      throw new Error(`kanban task sync returned ${response.status}`);
    }
    const body: unknown = await response.json();
    applyRemoteResponse(body, link);
    // Upload local additions and tombstones the backend does not know yet;
    // an unchanged board is not sent back on every poll.
    const remote = parseKanbanSyncResponse(body).map((task) => ({ ...task, backendConnectionId }));
    if (JSON.stringify(prepareKanbanSyncPayload(tasksForConnection(backendConnectionId))) !== JSON.stringify(prepareKanbanSyncPayload(remote))) {
      scheduleKanbanBackendPush(link);
    }
  } catch (error) {
    console.warn('kanban task sync failed', error);
  }
}

function applyRemoteResponse(body: unknown, link: KanbanSyncLink): void {
  // A response for a link replaced meanwhile only merges its
  // (connection-tagged) tasks; the zone belongs to the current one.
  if (syncLinks.get(link.config.backendConnectionId) === link) setTimeZone(link, parseKanbanTimeZone(body));
  applyRemoteTasks(parseKanbanSyncResponse(body), link.config.backendConnectionId);
}

function applyRemoteTasks(remote: KanbanTask[], backendConnectionId: string): void {
  const tagged = remote.map((task) => ({ ...task, backendConnectionId }));
  const next = mergeKanbanTasks(tasks, tagged);
  if (JSON.stringify(next) === JSON.stringify(tasks)) return;
  commit(next, { push: false });
}

/** Debounced push to one backend, or to every connected backend (each only
 * uploads its own tasks). */
function scheduleKanbanBackendPush(link?: KanbanSyncLink) {
  if (!link) {
    for (const each of syncLinks.values()) scheduleKanbanBackendPush(each);
    return;
  }
  if (!link.supported) return;
  if (link.pushTimer) clearTimeout(link.pushTimer);
  link.pushTimer = setTimeout(() => {
    link.pushTimer = null;
    void pushKanbanTasksToBackend(link);
  }, WORKSPACE_SYNC_DEBOUNCE_MS);
}

async function pushKanbanTasksToBackend(link: KanbanSyncLink): Promise<void> {
  if (!link.supported || syncLinks.get(link.config.backendConnectionId) !== link) return;
  if (link.pushInFlight) {
    link.pushAgain = true;
    return;
  }
  link.pushInFlight = true;
  try {
    const body = JSON.stringify({ tasks: prepareKanbanSyncPayload(tasksForConnection(link.config.backendConnectionId)) });
    const response = await backendFetch(link.config, {
      method: 'PUT',
      path: '/v2/kanban/tasks',
      body,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
    });
    if (response.status === 404) {
      link.supported = false;
      return;
    }
    if (!response.ok) {
      const error = await readBackendError(response, t('kanban.syncFailed'));
      // The backend refused the board itself (too many tasks, an invalid
      // field): retrying cannot help, so the user is told once.
      if (response.status >= 400 && response.status < 500 && link.shownError !== error.message) {
        link.shownError = error.message;
        toast.danger(error.message);
      }
      throw error;
    }
    link.shownError = undefined;
    applyRemoteResponse(await response.json(), link);
  } catch (error) {
    console.warn('kanban task sync failed', error);
  } finally {
    link.pushInFlight = false;
    if (link.pushAgain) {
      link.pushAgain = false;
      scheduleKanbanBackendPush(link);
    }
  }
}

/** Test-only hard reset: drops tombstones and clears the persisted cache. */
export function resetKanbanTasksForTests(): void {
  tasks = [];
  emit();
  void saveJson(KANBAN_TASKS_STORAGE_KEY, tasks).catch(() => {});
}

export function addKanbanTask(
  workspaceId: string,
  title: string,
  details?: { description?: string; dueDate?: string; priority?: KanbanTaskPriority; parentId?: string },
): KanbanTask | null {
  const name = title.trim().slice(0, KANBAN_TASK_TITLE_LIMIT);
  const activeCount = tasks.filter((task) => !task.deletedAt).length;
  // Subtasks are one level deep and live in their parent's workspace.
  const parent = details?.parentId
    ? tasks.find((task) => task.id === details.parentId && !task.deletedAt && !task.parentId)
    : undefined;
  if (details?.parentId && !parent) return null;
  if (parent) workspaceId = parent.workspaceId;
  if (!workspaceId || !name || activeCount >= KANBAN_TASK_LIMIT) return null;
  const description = details?.description?.trim().slice(0, KANBAN_TASK_DESCRIPTION_LIMIT) || undefined;
  const dueDate = details?.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(details.dueDate)
    ? details.dueDate
    : undefined;
  const now = Date.now();
  // Append after manually ordered siblings; untouched groups stay unordered so
  // they keep their createdAt order.
  const groupOrders = (parent
    ? tasks.filter((item) => item.parentId === parent.id && !item.deletedAt)
    : tasks.filter((item) => item.workspaceId === workspaceId && item.status === 'planned' && !item.deletedAt && !item.parentId))
    .map((item) => item.sortOrder)
    .filter((order): order is number => order !== undefined);
  const task: KanbanTask = {
    id: `task-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    backendConnectionId: workspaceBackendOf(workspaceId) || focusBackendId || null,
    title: name,
    description,
    dueDate,
    status: 'planned',
    ...(parent ? { parentId: parent.id } : {}),
    ...(details?.priority && kanbanTaskPriorities.includes(details.priority) ? { priority: details.priority } : {}),
    ...(groupOrders.length ? { sortOrder: Math.max(...groupOrders) + 1 } : {}),
    createdAt: now,
    updatedAt: now,
  };
  commit([...tasks, task]);
  return task;
}

export function renameKanbanTask(id: string, title: string): void {
  const name = title.trim().slice(0, KANBAN_TASK_TITLE_LIMIT);
  if (!name) return;
  commit(tasks.map((task) => (
    task.id === id && !task.deletedAt && task.title !== name ? { ...task, title: name, updatedAt: Date.now() } : task
  )));
}

export function setKanbanTaskPriority(id: string, priority: KanbanTaskPriority | null): void {
  commit(tasks.map((task) => {
    if (task.id !== id || task.deletedAt || (task.priority ?? null) === priority) return task;
    const next: KanbanTask = { ...task, updatedAt: Date.now() };
    if (priority && kanbanTaskPriorities.includes(priority)) next.priority = priority;
    else delete next.priority;
    return next;
  }));
}

/** Edits the description and due date; an empty value clears the field. */
export function updateKanbanTaskDetails(id: string, details: { description?: string; dueDate?: string }): void {
  commit(tasks.map((task) => {
    if (task.id !== id || task.deletedAt) return task;
    const next: KanbanTask = { ...task };
    if (details.description !== undefined) {
      const description = details.description.trim().slice(0, KANBAN_TASK_DESCRIPTION_LIMIT);
      if (description) next.description = description;
      else delete next.description;
    }
    if (details.dueDate !== undefined) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(details.dueDate)) next.dueDate = details.dueDate;
      else delete next.dueDate;
    }
    if (next.description === task.description && next.dueDate === task.dueDate) return task;
    return { ...next, updatedAt: Date.now() };
  }));
}

export function setKanbanTaskStatus(id: string, status: KanbanTaskStatus): void {
  if (!kanbanTaskStatuses.includes(status)) return;
  const task = tasks.find((item) => item.id === id && !item.deletedAt);
  if (!task || task.status === status) return;
  if (task.parentId) {
    commit(tasks.map((item) => (item.id === id ? { ...item, status, updatedAt: Date.now() } : item)));
    rollUpParentStatus(task.parentId);
    return;
  }
  // A status change appends the task at the end of the target group.
  moveKanbanTasks([id], { workspaceId: task.workspaceId, status, index: Number.MAX_SAFE_INTEGER });
}

/** The parent follows its subtasks: done once all are, in progress once any
 * has started (or one reopens after the parent was done). */
function rollUpParentStatus(parentId: string): void {
  const parent = tasks.find((item) => item.id === parentId && !item.deletedAt);
  const children = tasks.filter((item) => item.parentId === parentId && !item.deletedAt);
  if (!parent || !children.length) return;
  const next: KanbanTaskStatus = children.every((item) => item.status === 'done')
    ? 'done'
    : children.some((item) => item.status !== 'planned') || parent.status === 'done' ? 'in-progress' : parent.status;
  if (next !== parent.status) setKanbanTaskStatus(parent.id, next);
}

/** Active subtasks of a task, in their manual order. */
export function kanbanSubtasks(all: readonly KanbanTask[], parentId: string): KanbanTask[] {
  return all.filter((task) => task.parentId === parentId && !task.deletedAt).sort(compareKanbanTasks);
}

/** Reorders a subtask among its siblings. */
export function moveKanbanSubtask(id: string, index: number): void {
  const task = tasks.find((item) => item.id === id && !item.deletedAt);
  if (!task?.parentId) return;
  const siblings = kanbanSubtasks(tasks, task.parentId).filter((item) => item.id !== id);
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, task);
  const orders = new Map(siblings.map((item, order) => [item.id, order]));
  const now = Date.now();
  commit(tasks.map((item) => {
    const order = orders.get(item.id);
    return order === undefined || order === item.sortOrder ? item : { ...item, sortOrder: order, updatedAt: now };
  }));
}

/** A task holds one conversation; once split into subtasks, each subtask
 * holds its own instead. */
export function kanbanTaskCanStartConversation(task: KanbanTask, all: readonly KanbanTask[]): boolean {
  return kanbanTaskConversationIds(task).length === 0
    && !all.some((item) => item.parentId === task.id && !item.deletedAt);
}

/** Attached conversation ids; tolerates the legacy single `conversationId`. */
export function kanbanTaskConversationIds(task: KanbanTask): string[] {
  return task.conversationIds ?? (task.conversationId ? [task.conversationId] : []);
}

function withConversations(task: KanbanTask, conversationIds: string[]): KanbanTask {
  const next: KanbanTask = { ...task, updatedAt: Date.now() };
  if (conversationIds.length) {
    next.conversationIds = conversationIds;
    // Mirror the first id for older clients that only read `conversationId`.
    next.conversationId = conversationIds[0];
  } else {
    delete next.conversationIds;
    delete next.conversationId;
  }
  return next;
}

export function attachKanbanTask(id: string, conversationId: string): void {
  if (!conversationId) return;
  commit(tasks.map((task) => {
    if (task.id !== id || task.deletedAt) return task;
    const ids = kanbanTaskConversationIds(task);
    return ids.includes(conversationId) ? task : withConversations(task, [...ids, conversationId]);
  }));
}

export function detachKanbanTask(id: string, conversationId: string): void {
  commit(tasks.map((task) => {
    if (task.id !== id || task.deletedAt) return task;
    const ids = kanbanTaskConversationIds(task);
    return ids.includes(conversationId)
      ? withConversations(task, ids.filter((item) => item !== conversationId))
      : task;
  }));
}

/** Swaps a linked id in place, e.g. a local draft id for its backend id. */
export function replaceKanbanTaskConversation(id: string, from: string, to: string): void {
  if (!to || from === to) return;
  commit(tasks.map((task) => {
    if (task.id !== id || task.deletedAt) return task;
    const ids = kanbanTaskConversationIds(task);
    if (!ids.includes(from)) return task;
    return withConversations(task, [...new Set(ids.map((item) => (item === from ? to : item)))]);
  }));
}

export function setKanbanTaskConversations(id: string, conversationIds: string[]): void {
  const unique = [...new Set(conversationIds.filter(Boolean))];
  commit(tasks.map((task) => {
    if (task.id !== id || task.deletedAt) return task;
    const current = kanbanTaskConversationIds(task);
    if (current.length === unique.length && current.every((item, index) => item === unique[index])) return task;
    return withConversations(task, unique);
  }));
}

/** Cancels a pending schedule. It stays on the task as `cancelled`: a
 * dropped field would read as a client that does not know schedules. */
export function cancelKanbanTaskSchedule(id: string): void {
  commit(tasks.map((task) => (
    task.id === id && !task.deletedAt && task.schedule?.status === 'pending'
      ? { ...task, schedule: { ...task.schedule, status: 'cancelled' }, updatedAt: Date.now() }
      : task
  )));
}

/** Wall-clock `YYYY-MM-DDTHH:MM` in the backend's zone at `now`. */
export function kanbanBackendLocalTime(zone: KanbanTimeZone, now = Date.now()): string {
  return new Date(now + zone.offsetMinutes * 60_000).toISOString().slice(0, 16);
}

/** Display label of the backend zone, e.g. `Asia/Shanghai (UTC+08:00)`. */
export function kanbanTimeZoneLabel(zone: KanbanTimeZone): string {
  const sign = zone.offsetMinutes < 0 ? '-' : '+';
  const minutes = Math.abs(zone.offsetMinutes);
  const offset = `UTC${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return zone.name ? `${zone.name} (${offset})` : offset;
}

function compareKanbanTasks(a: KanbanTask, b: KanbanTask): number {
  return (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
    || a.createdAt - b.createdAt
    || a.id.localeCompare(b.id);
}

function orderedGroup(workspaceId: string, status: KanbanTaskStatus, excludeIds?: Set<string>): KanbanTask[] {
  return tasks
    .filter((task) => task.workspaceId === workspaceId && task.status === status && !task.deletedAt && !task.parentId && !excludeIds?.has(task.id))
    .sort(compareKanbanTasks);
}

/** Moves tasks into the target workspace status group at `index`, compacting
 * sortOrder for every touched group so the manual order survives sync. */
export function moveKanbanTasks(
  ids: string[],
  target: { workspaceId: string; status: KanbanTaskStatus; index: number },
): void {
  const movingIds = new Set(ids);
  const moving = ids
    .map((id) => tasks.find((task) => task.id === id && !task.deletedAt))
    .filter((task): task is KanbanTask => Boolean(task));
  if (!moving.length || !target.workspaceId || !kanbanTaskStatuses.includes(target.status)) return;
  const now = Date.now();
  const moved = moving.map((task) => ({ ...task, workspaceId: target.workspaceId, status: target.status, updatedAt: now }));

  const patches = new Map<string, KanbanTask>();
  const groups = new Map<string, KanbanTask[]>();
  const groupKey = (workspaceId: string, status: KanbanTaskStatus) => `${workspaceId}\n${status}`;
  const group = (workspaceId: string, status: KanbanTaskStatus) => {
    const key = groupKey(workspaceId, status);
    let items = groups.get(key);
    if (!items) {
      items = orderedGroup(workspaceId, status, movingIds);
      groups.set(key, items);
    }
    return items;
  };

  const targetKey = groupKey(target.workspaceId, target.status);
  for (const task of moving) {
    const key = groupKey(task.workspaceId, task.status);
    if (key !== targetKey) group(task.workspaceId, task.status);
  }
  const targetItems = group(target.workspaceId, target.status);
  targetItems.splice(Math.max(0, Math.min(target.index, targetItems.length)), 0, ...moved);
  for (const items of groups.values()) {
    items.forEach((task, index) => patches.set(task.id, { ...task, sortOrder: index }));
  }
  // Subtasks follow their parent to another workspace.
  for (const task of tasks) {
    if (task.parentId && movingIds.has(task.parentId) && !task.deletedAt && task.workspaceId !== target.workspaceId) {
      patches.set(task.id, { ...task, workspaceId: target.workspaceId, updatedAt: now });
    }
  }
  commit(tasks.map((task) => patches.get(task.id) ?? task));
}

/** Deletes a task with its subtasks; deleting a subtask updates the parent's
 * rolled-up status. */
export function removeKanbanTask(id: string): void {
  const now = Date.now();
  const parentId = tasks.find((task) => task.id === id)?.parentId;
  commit(tasks.map((task) => (
    (task.id === id || task.parentId === id) && !task.deletedAt ? { ...task, deletedAt: now, updatedAt: now } : task
  )));
  if (parentId) rollUpParentStatus(parentId);
}

export function kanbanTasksForWorkspace(
  all: readonly KanbanTask[],
  workspaceId: string,
  connectionId?: string | null,
): KanbanTask[] {
  const parents = new Set(all.filter((task) => !task.deletedAt && !task.parentId).map((task) => task.id));
  return all
    // Subtasks show inside their parent; one whose parent is gone stands alone.
    .filter((task) => task.workspaceId === workspaceId && !task.deletedAt && !(task.parentId && parents.has(task.parentId)))
    .filter((task) => connectionId === undefined
      || !task.backendConnectionId
      || task.backendConnectionId === connectionId)
    .sort(compareKanbanTasks);
}

export function isKanbanTaskOverdue(task: KanbanTask, now = new Date()): boolean {
  if (!task.dueDate || task.status === 'done') return false;
  const pad = (value: number) => String(value).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return task.dueDate < today;
}

export function kanbanTaskDraftText(task: KanbanTask): string {
  // A subtask's description is its prompt.
  if (task.parentId && task.description) return task.description;
  const lines = [t('kanban.draftTask', { title: task.title })];
  if (task.description) lines.push(t('kanban.draftDesc', { description: task.description }));
  if (task.dueDate) lines.push(t('kanban.draftDue', { dueDate: task.dueDate }));
  return lines.join('\n');
}

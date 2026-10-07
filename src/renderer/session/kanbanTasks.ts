import { useSyncExternalStore } from 'react';
import {
  KANBAN_TASK_STATUSES,
  mergeKanbanTasks,
  normalizeKanbanTask,
  parseKanbanSyncResponse,
  prepareKanbanSyncPayload,
  type KanbanTask,
  type KanbanTaskStatus,
} from '@todex/protocol/todex';
import { loadJson, saveJson } from '../lib/storage';
import { KANBAN_TASKS_STORAGE_KEY, WORKSPACE_SYNC_DEBOUNCE_MS, backendFetch, type BackendTransportProfile } from './helpers';
import { t } from '../i18n';

export type { KanbanTask, KanbanTaskStatus };

export const kanbanTaskStatuses: readonly KanbanTaskStatus[] = KANBAN_TASK_STATUSES;

const kanbanTaskStatusKeys: Record<KanbanTaskStatus, 'kanban.statusPlanned' | 'kanban.statusInProgress' | 'kanban.statusDone'> = {
  planned: 'kanban.statusPlanned',
  'in-progress': 'kanban.statusInProgress',
  done: 'kanban.statusDone',
};

export function kanbanTaskStatusLabel(status: KanbanTaskStatus): string {
  return t(kanbanTaskStatusKeys[status]);
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

let syncConfig: KanbanSyncConfig | null = null;
// A 404 marks a backend older than the sync endpoints; stay local-only until
// the configuration changes instead of retrying every poll cycle.
let syncSupported = true;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
let pushAgain = false;

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

function tasksForConnection(connectionId: string): KanbanTask[] {
  return tasks.filter((task) => !task.backendConnectionId || task.backendConnectionId === connectionId);
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

export function configureKanbanSync(config: KanbanSyncConfig | null): void {
  const previous = syncConfig;
  syncConfig = config;
  if (!config) return;
  const changed = !previous
    || previous.serverUrl !== config.serverUrl
    || previous.deviceSecret !== config.deviceSecret
    || previous.encryptionProtocol !== config.encryptionProtocol
    || previous.encryptionPublicKey !== config.encryptionPublicKey
    || previous.transportVerified !== config.transportVerified
    || previous.backendConnectionId !== config.backendConnectionId;
  if (changed) {
    syncSupported = true;
    void syncKanbanTasksFromBackend();
  }
}

export async function syncKanbanTasksFromBackend(): Promise<void> {
  const config = syncConfig;
  if (!config || !syncSupported) return;
  try {
    const response = await backendFetch(config, {
      method: 'GET',
      path: '/v2/kanban/tasks',
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) {
      syncSupported = false;
      return;
    }
    if (!response.ok) {
      throw new Error(`kanban task sync returned ${response.status}`);
    }
    applyRemoteTasks(parseKanbanSyncResponse(await response.json()), config.backendConnectionId);
    // Upload local additions and tombstones the backend does not know yet.
    scheduleKanbanBackendPush();
  } catch (error) {
    console.warn('kanban task sync failed', error);
  }
}

function applyRemoteTasks(remote: KanbanTask[], backendConnectionId: string): void {
  const tagged = remote.map((task) => ({ ...task, backendConnectionId }));
  const next = mergeKanbanTasks(tasks, tagged);
  if (JSON.stringify(next) === JSON.stringify(tasks)) return;
  commit(next, { push: false });
}

function scheduleKanbanBackendPush() {
  if (!syncConfig || !syncSupported) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushKanbanTasksToBackend();
  }, WORKSPACE_SYNC_DEBOUNCE_MS);
}

async function pushKanbanTasksToBackend(): Promise<void> {
  const config = syncConfig;
  if (!config || !syncSupported) return;
  if (pushInFlight) {
    pushAgain = true;
    return;
  }
  pushInFlight = true;
  try {
    const body = JSON.stringify({ tasks: prepareKanbanSyncPayload(tasksForConnection(config.backendConnectionId)) });
    const response = await backendFetch(config, {
      method: 'PUT',
      path: '/v2/kanban/tasks',
      body,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
    });
    if (response.status === 404) {
      syncSupported = false;
      return;
    }
    if (!response.ok) {
      throw new Error(`kanban task sync returned ${response.status}`);
    }
    applyRemoteTasks(parseKanbanSyncResponse(await response.json()), config.backendConnectionId);
  } catch (error) {
    console.warn('kanban task sync failed', error);
  } finally {
    pushInFlight = false;
    if (pushAgain) {
      pushAgain = false;
      scheduleKanbanBackendPush();
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
  details?: { description?: string; dueDate?: string },
): KanbanTask | null {
  const name = title.trim().slice(0, KANBAN_TASK_TITLE_LIMIT);
  const activeCount = tasks.filter((task) => !task.deletedAt).length;
  if (!workspaceId || !name || activeCount >= KANBAN_TASK_LIMIT) return null;
  const description = details?.description?.trim().slice(0, KANBAN_TASK_DESCRIPTION_LIMIT) || undefined;
  const dueDate = details?.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(details.dueDate)
    ? details.dueDate
    : undefined;
  const now = Date.now();
  // Append after manually ordered siblings; untouched groups stay unordered so
  // they keep their createdAt order.
  const groupOrders = tasks
    .filter((item) => item.workspaceId === workspaceId && item.status === 'planned' && !item.deletedAt)
    .map((item) => item.sortOrder)
    .filter((order): order is number => order !== undefined);
  const task: KanbanTask = {
    id: `task-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    backendConnectionId: syncConfig?.backendConnectionId ?? null,
    title: name,
    description,
    dueDate,
    status: 'planned',
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

export function setKanbanTaskStatus(id: string, status: KanbanTaskStatus): void {
  if (!kanbanTaskStatuses.includes(status)) return;
  const task = tasks.find((item) => item.id === id && !item.deletedAt);
  if (!task || task.status === status) return;
  // A status change appends the task at the end of the target group.
  moveKanbanTasks([id], { workspaceId: task.workspaceId, status, index: Number.MAX_SAFE_INTEGER });
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

export function setKanbanTaskConversations(id: string, conversationIds: string[]): void {
  const unique = [...new Set(conversationIds.filter(Boolean))];
  commit(tasks.map((task) => {
    if (task.id !== id || task.deletedAt) return task;
    const current = kanbanTaskConversationIds(task);
    if (current.length === unique.length && current.every((item, index) => item === unique[index])) return task;
    return withConversations(task, unique);
  }));
}

function compareKanbanTasks(a: KanbanTask, b: KanbanTask): number {
  return (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
    || a.createdAt - b.createdAt
    || a.id.localeCompare(b.id);
}

function orderedGroup(workspaceId: string, status: KanbanTaskStatus, excludeIds?: Set<string>): KanbanTask[] {
  return tasks
    .filter((task) => task.workspaceId === workspaceId && task.status === status && !task.deletedAt && !excludeIds?.has(task.id))
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
  commit(tasks.map((task) => patches.get(task.id) ?? task));
}

export function removeKanbanTask(id: string): void {
  const now = Date.now();
  commit(tasks.map((task) => (
    task.id === id && !task.deletedAt ? { ...task, deletedAt: now, updatedAt: now } : task
  )));
}

export function kanbanTasksForWorkspace(
  all: readonly KanbanTask[],
  workspaceId: string,
  connectionId?: string | null,
): KanbanTask[] {
  return all
    .filter((task) => task.workspaceId === workspaceId && !task.deletedAt)
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
  const lines = [t('kanban.draftTask', { title: task.title })];
  if (task.description) lines.push(t('kanban.draftDesc', { description: task.description }));
  if (task.dueDate) lines.push(t('kanban.draftDue', { dueDate: task.dueDate }));
  return lines.join('\n');
}

import { useSyncExternalStore } from 'react';
import {
  buildHttpUrl,
  KANBAN_TASK_STATUSES,
  mergeKanbanTasks,
  normalizeKanbanTask,
  parseKanbanSyncResponse,
  prepareKanbanSyncPayload,
  type KanbanTask,
  type KanbanTaskStatus,
} from '@todex/protocol/todex';
import { loadJson, saveJson } from '../lib/storage';
import { KANBAN_TASKS_STORAGE_KEY, WORKSPACE_SYNC_DEBOUNCE_MS } from './helpers';
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

export type KanbanSyncConfig = {
  serverUrl: string;
  authToken: string;
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
    || previous.authToken !== config.authToken
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
    const response = await fetch(buildHttpUrl(config.serverUrl, '/v2/kanban/tasks'), {
      headers: config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {},
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
    const response = await fetch(buildHttpUrl(config.serverUrl, '/v2/kanban/tasks'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      body: JSON.stringify({ tasks: prepareKanbanSyncPayload(tasksForConnection(config.backendConnectionId)) }),
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
  const task: KanbanTask = {
    id: `task-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    backendConnectionId: syncConfig?.backendConnectionId ?? null,
    title: name,
    description,
    dueDate,
    status: 'planned',
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
  commit(tasks.map((task) => (
    task.id === id && !task.deletedAt && task.status !== status ? { ...task, status, updatedAt: Date.now() } : task
  )));
}

export function attachKanbanTask(id: string, conversationId?: string): void {
  commit(tasks.map((task) => {
    if (task.id !== id || task.deletedAt || task.conversationId === conversationId) return task;
    if (!conversationId) {
      const next: KanbanTask = { ...task, updatedAt: Date.now() };
      delete next.conversationId;
      return next;
    }
    return { ...task, conversationId, updatedAt: Date.now() };
  }));
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
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
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

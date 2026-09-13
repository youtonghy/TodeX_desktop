import { useSyncExternalStore } from 'react';
import { loadJson, saveJson } from '../lib/storage';
import { KANBAN_TASKS_STORAGE_KEY } from './helpers';

export type KanbanTaskStatus = 'planned' | 'in-progress' | 'done';

export interface KanbanTask {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  /** ISO date `YYYY-MM-DD`. */
  dueDate?: string;
  status: KanbanTaskStatus;
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
}

export const kanbanTaskStatuses: readonly KanbanTaskStatus[] = ['planned', 'in-progress', 'done'];

export const kanbanTaskStatusLabels: Record<KanbanTaskStatus, string> = {
  planned: '计划',
  'in-progress': '进行中',
  done: '已完成',
};

const KANBAN_TASK_TITLE_LIMIT = 200;
const KANBAN_TASK_DESCRIPTION_LIMIT = 2000;
const KANBAN_TASK_LIMIT = 500;

let tasks: KanbanTask[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function normalizeTask(value: unknown): KanbanTask | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : '';
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const status = kanbanTaskStatuses.includes(record.status as KanbanTaskStatus)
    ? (record.status as KanbanTaskStatus)
    : 'planned';
  if (!id || !workspaceId || !title) return null;
  const description = typeof record.description === 'string' && record.description.trim()
    ? record.description.trim()
    : undefined;
  const dueDate = typeof record.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate)
    ? record.dueDate
    : undefined;
  const conversationId = typeof record.conversationId === 'string' && record.conversationId
    ? record.conversationId
    : undefined;
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : 0;
  const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;
  return { id, workspaceId, title, description, dueDate, status, conversationId, createdAt, updatedAt };
}

function emit() {
  for (const listener of listeners) listener();
}

function ensureLoaded() {
  loading ??= loadJson<unknown>(KANBAN_TASKS_STORAGE_KEY, [])
    .then((value) => {
      if (!Array.isArray(value)) return;
      tasks = value
        .map(normalizeTask)
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

function commit(next: KanbanTask[]) {
  tasks = next;
  emit();
  void saveJson(KANBAN_TASKS_STORAGE_KEY, next).catch(() => {});
}

export function getKanbanTasks(): KanbanTask[] {
  return tasks;
}

export function useKanbanTasks(): KanbanTask[] {
  return useSyncExternalStore(subscribe, getKanbanTasks);
}

export function addKanbanTask(
  workspaceId: string,
  title: string,
  details?: { description?: string; dueDate?: string },
): KanbanTask | null {
  const name = title.trim().slice(0, KANBAN_TASK_TITLE_LIMIT);
  if (!workspaceId || !name || tasks.length >= KANBAN_TASK_LIMIT) return null;
  const description = details?.description?.trim().slice(0, KANBAN_TASK_DESCRIPTION_LIMIT) || undefined;
  const dueDate = details?.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(details.dueDate)
    ? details.dueDate
    : undefined;
  const now = Date.now();
  const task: KanbanTask = {
    id: `task-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
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
    task.id === id && task.title !== name ? { ...task, title: name, updatedAt: Date.now() } : task
  )));
}

export function setKanbanTaskStatus(id: string, status: KanbanTaskStatus): void {
  if (!kanbanTaskStatuses.includes(status)) return;
  commit(tasks.map((task) => (
    task.id === id && task.status !== status ? { ...task, status, updatedAt: Date.now() } : task
  )));
}

export function attachKanbanTask(id: string, conversationId?: string): void {
  commit(tasks.map((task) => {
    if (task.id !== id || task.conversationId === conversationId) return task;
    if (!conversationId) {
      const next: KanbanTask = { ...task, updatedAt: Date.now() };
      delete next.conversationId;
      return next;
    }
    return { ...task, conversationId, updatedAt: Date.now() };
  }));
}

export function removeKanbanTask(id: string): void {
  commit(tasks.filter((task) => task.id !== id));
}

export function kanbanTasksForWorkspace(all: readonly KanbanTask[], workspaceId: string): KanbanTask[] {
  return all
    .filter((task) => task.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function isKanbanTaskOverdue(task: KanbanTask, now = new Date()): boolean {
  if (!task.dueDate || task.status === 'done') return false;
  const pad = (value: number) => String(value).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return task.dueDate < today;
}

export function kanbanTaskDraftText(task: KanbanTask): string {
  const lines = [`任务：${task.title}`];
  if (task.description) lines.push(`描述：${task.description}`);
  if (task.dueDate) lines.push(`截止日期：${task.dueDate}`);
  return lines.join('\n');
}

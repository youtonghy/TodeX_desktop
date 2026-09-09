import { SETTINGS_STORAGE_KEY } from './helpers';
import type { OpenPanelOptions, WorkbenchTab } from '../lib/panels';

export function workbenchScopeKey(mode: 'conversation' | 'workspace', backendId: string, workspaceId: string, conversationId: string): string {
  if (!backendId || !workspaceId || (mode === 'conversation' && !conversationId)) return '';
  return JSON.stringify([mode, backendId, workspaceId, ...(mode === 'conversation' ? [conversationId] : [])]);
}

export type WorkbenchLayout = { hydrated: boolean; isOpen: boolean; tab: WorkbenchTab; target: OpenPanelOptions };
type SavedLayout = Omit<WorkbenchLayout, 'hydrated'>;
type Storage = { load: (key: string) => Promise<unknown>; save: (key: string, value: SavedLayout) => Promise<void> };
type Entry = { state: WorkbenchLayout; dirty: Set<keyof SavedLayout>; hydration?: Promise<void>; writes: Promise<void> };
const defaults = (): WorkbenchLayout => ({ hydrated: false, isOpen: false, tab: 'terminal', target: {} });
export const workbenchLayoutStorageKey = (scopeKey: string) => `${SETTINGS_STORAGE_KEY}.workbenchLayout.v1:${scopeKey}`;

/** Never persist commands, URL credentials, query strings, or fragments. */
function safeTarget(value: unknown): OpenPanelOptions {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const target: OpenPanelOptions = {};
  for (const key of ['workspaceId', 'conversationId', 'filePath'] as const) {
    if (typeof source[key] === 'string') target[key] = source[key];
  }
  if (typeof source.url === 'string') {
    try {
      const url = new URL(source.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') target.url = `${url.origin}${url.pathname}`;
    } catch { /* Invalid URLs are not restored. */ }
  }
  return target;
}

export function normalizeWorkbenchLayout(value: unknown): SavedLayout {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const tab = ['terminal', 'browser', 'files', 'git-diff'].includes(String(source.tab)) ? source.tab as WorkbenchTab : 'terminal';
  return { isOpen: source.isOpen === true, tab, target: safeTarget(source.target) };
}

/** One instance per mounted shell; each scope owns its load and ordered writes. */
export class WorkbenchLayoutStore {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  constructor(private storage: Storage) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(listener => listener()); }
  private entry(scope: string): Entry {
    let entry = this.entries.get(scope);
    if (!entry) {
      entry = { state: { ...defaults(), hydrated: !scope }, dirty: new Set(), writes: Promise.resolve() };
      this.entries.set(scope, entry);
    }
    return entry;
  }
  snapshot = (scope: string): WorkbenchLayout => this.entry(scope).state;
  private save(scope: string, entry: Entry) {
    if (!scope) return;
    const value = normalizeWorkbenchLayout(entry.state);
    entry.writes = entry.writes.then(() => this.storage.save(workbenchLayoutStorageKey(scope), value)).catch(() => {
      // Keep the current layout usable if storage is temporarily unavailable.
    });
  }
  hydrate(scope: string): Promise<void> {
    const entry = this.entry(scope);
    if (!scope || entry.state.hydrated) return Promise.resolve();
    if (entry.hydration) return entry.hydration;
    entry.hydration = this.storage.load(workbenchLayoutStorageKey(scope)).catch(() => null).then(value => {
      const loaded = normalizeWorkbenchLayout(value);
      entry.state = { hydrated: true,
        isOpen: entry.dirty.has('isOpen') ? entry.state.isOpen : loaded.isOpen,
        tab: entry.dirty.has('tab') ? entry.state.tab : loaded.tab,
        target: entry.dirty.has('target') ? entry.state.target : loaded.target };
      if (entry.dirty.size) this.save(scope, entry);
      entry.dirty.clear();
      this.emit();
    });
    return entry.hydration;
  }
  update<K extends keyof SavedLayout>(scope: string, field: K, update: SavedLayout[K] | ((current: SavedLayout[K]) => SavedLayout[K])) {
    const entry = this.entry(scope);
    const next = typeof update === 'function'
      ? (update as (current: SavedLayout[K]) => SavedLayout[K])(entry.state[field]) : update;
    entry.state = { ...entry.state, [field]: next };
    if (entry.state.hydrated) this.save(scope, entry);
    else entry.dirty.add(field);
    this.emit();
  }
}

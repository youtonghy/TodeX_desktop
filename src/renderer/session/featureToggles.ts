import { useSyncExternalStore } from 'react';

/** Optional sidebar features the user can show, fold under "More", or turn off. */
export const FEATURE_IDS = ['scheduledConversations', 'terminal', 'kanban'] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];
export type FeatureMode = 'shown' | 'folded' | 'off';
export type FeatureModes = Record<FeatureId, FeatureMode>;

const STORAGE_KEY = 'todex.features.v1';
const MORE_KEY = 'todex.features.moreOpen.v1';
const DEFAULTS: FeatureModes = { scheduledConversations: 'shown', terminal: 'shown', kanban: 'shown' };

const isMode = (value: unknown): value is FeatureMode => value === 'shown' || value === 'folded' || value === 'off';

function readModes(): FeatureModes {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const record = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
    return Object.fromEntries(FEATURE_IDS.map((id) => [id, isMode(record[id]) ? record[id] : DEFAULTS[id]])) as FeatureModes;
  } catch {
    return DEFAULTS;
  }
}

function readMoreOpen() {
  try { return localStorage.getItem(MORE_KEY) === '1'; } catch { return false; }
}

// One shared snapshot, so the settings page and the sidebar never disagree.
let modes = readModes();
let moreOpen = readMoreOpen();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window (or tab, on the web) changed the preference.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== MORE_KEY) return;
    modes = readModes();
    moreOpen = readMoreOpen();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setFeatureMode(id: FeatureId, mode: FeatureMode) {
  if (modes[id] === mode) return;
  modes = { ...modes, [id]: mode };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(modes)); } catch { /* Storage may be disabled. */ }
  emit();
}

export function setFeaturesMoreOpen(open: boolean) {
  if (moreOpen === open) return;
  moreOpen = open;
  try { localStorage.setItem(MORE_KEY, open ? '1' : '0'); } catch { /* Storage may be disabled. */ }
  emit();
}

/** Per-device feature modes; never synced to the backend. */
export function useFeatureModes(): FeatureModes {
  return useSyncExternalStore(subscribe, () => modes);
}

/** Whether the sidebar's "More" row shows its folded features. */
export function useFeaturesMoreOpen(): boolean {
  return useSyncExternalStore(subscribe, () => moreOpen);
}

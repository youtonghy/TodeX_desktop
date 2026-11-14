import { useSyncExternalStore } from 'react';

/** Where a live view of the agent's desktop tools shows: a Workbench tab in
 * the side panel, or a card pinned above the composer. */
export type LiveViewPlacement = 'sidebar' | 'composer';

/** Per-device placement of the agent browser and Computer Use live views;
 * never synced to the backend. */
export type AgentDesktopPreferences = {
  browserPlacement: LiveViewPlacement;
  computerPlacement: LiveViewPlacement;
};

const STORAGE_KEY = 'todex.agentDesktop.v1';
const DEFAULTS: AgentDesktopPreferences = { browserPlacement: 'sidebar', computerPlacement: 'sidebar' };

const placement = (value: unknown, fallback: LiveViewPlacement): LiveViewPlacement =>
  value === 'sidebar' || value === 'composer' ? value : fallback;

function readPreferences(): AgentDesktopPreferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const record = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
    return {
      browserPlacement: placement(record.browserPlacement, DEFAULTS.browserPlacement),
      computerPlacement: placement(record.computerPlacement, DEFAULTS.computerPlacement),
    };
  } catch {
    return DEFAULTS;
  }
}

// One shared snapshot, so the settings page, the side panel and the composer agree.
let preferences = readPreferences();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window (or tab, on the web) changed the preferences.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    preferences = readPreferences();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getAgentDesktopPreferences(): AgentDesktopPreferences {
  return preferences;
}

export function setAgentDesktopPreferences(patch: Partial<AgentDesktopPreferences>) {
  preferences = { ...preferences, ...patch };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Storage may be disabled. */ }
  preferences = readPreferences();
  listeners.forEach((listener) => listener());
}

export function useAgentDesktopPreferences(): AgentDesktopPreferences {
  return useSyncExternalStore(subscribe, () => preferences);
}

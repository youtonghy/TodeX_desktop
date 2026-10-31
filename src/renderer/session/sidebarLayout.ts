import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/** `split`: separate workspace and conversation sections. `unified`: one
 * workspace tree, each workspace unfolding into its own conversations. */
export type SidebarLayout = 'split' | 'unified';

const LAYOUT_KEY = 'todex.sidebar.layout.v1';
const EXPANDED_KEY = 'todex.sidebar.workspaceExpanded.v1';

function readLayout(): SidebarLayout {
  try { return localStorage.getItem(LAYOUT_KEY) === 'unified' ? 'unified' : 'split'; } catch { return 'split'; }
}

// One shared snapshot, so the settings page and the sidebar never disagree.
let layout = readLayout();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window (or tab, on the web) changed the preference.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LAYOUT_KEY) return;
    layout = readLayout();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setSidebarLayout(next: SidebarLayout) {
  if (layout === next) return;
  layout = next;
  try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* Storage may be disabled. */ }
  listeners.forEach((listener) => listener());
}

/** Per-device sidebar layout; never synced to the backend. */
export function useSidebarLayout(): SidebarLayout {
  return useSyncExternalStore(subscribe, () => layout);
}

/** Workspace rows unfolded into their conversations (unified layout); a
 * per-device preference, never synced. */
export function useSidebarWorkspaceExpansion() {
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
      return Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === 'string'))] : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(expandedWorkspaces)); } catch { /* Storage may be disabled. */ }
  }, [expandedWorkspaces]);
  const toggleWorkspaceExpanded = useCallback((rowId: string) => {
    setExpandedWorkspaces((current) => (current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId]));
  }, []);
  const expandWorkspace = useCallback((rowId: string) => {
    setExpandedWorkspaces((current) => (current.includes(rowId) ? current : [...current, rowId]));
  }, []);
  return { expandedWorkspaces, toggleWorkspaceExpanded, expandWorkspace };
}

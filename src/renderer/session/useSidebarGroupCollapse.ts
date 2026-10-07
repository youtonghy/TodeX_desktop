import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'todex.sidebar.groupCollapsed.v1';

/** Folded workspace groups; a per-device preference, never synced. */
export function useSidebarGroupCollapse() {
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === 'string'))] : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsedGroups)); } catch { /* Storage may be disabled. */ }
  }, [collapsedGroups]);
  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setCollapsedGroups((current) => (current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]));
  }, []);
  return { collapsedGroups, toggleGroupCollapsed };
}

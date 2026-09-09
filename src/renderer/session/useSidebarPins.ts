import { useCallback, useEffect, useState } from 'react';

type PinKind = 'workspace' | 'conversation';
type SidebarPins = Record<PinKind, string[]>;
const STORAGE_KEY = 'todex.sidebar.pins.v1';

export function useSidebarPins() {
  const [pins, setPins] = useState<SidebarPins>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const ids = (value: unknown): string[] => Array.isArray(value)
        ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [];
      return { workspace: ids(saved?.workspace), conversation: ids(saved?.conversation) };
    } catch {
      return { workspace: [], conversation: [] };
    }
  });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pins)); } catch { /* Storage may be disabled. */ }
  }, [pins]);
  const togglePin = useCallback((kind: PinKind, id: string) => {
    setPins((current) => ({
      ...current,
      [kind]: current[kind].includes(id) ? current[kind].filter((item) => item !== id) : [...current[kind], id],
    }));
  }, []);
  return { pins, togglePin };
}

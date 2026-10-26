import { useCallback, useEffect, useState } from 'react';
import type { ContainerPrefs } from '../../preload/containerTypes';
import { loadJson, saveJson } from '../lib/storage';

/** Settings → TodeX Container → Automatic cleanup; the main process reads the same key. */
export const CONTAINER_PREFS_KEY = 'todex.desktop.container.v1';

export function useContainerPrefs(): [ContainerPrefs, (patch: Partial<ContainerPrefs>) => void] {
  const [prefs, setPrefs] = useState<ContainerPrefs>({});
  useEffect(() => {
    void loadJson<ContainerPrefs>(CONTAINER_PREFS_KEY, {}).then((value) => setPrefs(value && typeof value === 'object' ? value : {}));
  }, []);
  const update = useCallback((patch: Partial<ContainerPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      void saveJson(CONTAINER_PREFS_KEY, next);
      return next;
    });
  }, []);
  return [prefs, update];
}

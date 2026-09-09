import { useCallback, useEffect, useRef, useState } from 'react';
import { loadJson, saveJson } from '../lib/storage';
import { SETTINGS_STORAGE_KEY } from './helpers';

export type WorkbenchSharing = 'conversation' | 'workspace';
const STORAGE_KEY = `${SETTINGS_STORAGE_KEY}.workbenchSharing.v1`;

export function useWorkbenchSharing() {
  const [workbenchSharing, setSharing] = useState<WorkbenchSharing>('conversation');
  const [workbenchSharingHydrated, setHydrated] = useState(false);
  const changedRef = useRef(false);
  const savesRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    void loadJson<unknown>(STORAGE_KEY, 'conversation').then(value => {
      if (!cancelled && !changedRef.current) setSharing(value === 'workspace' ? 'workspace' : 'conversation');
    }).catch(() => {
      // Keep the independent default when local storage is unavailable.
    }).finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  const setWorkbenchSharing = useCallback((value: WorkbenchSharing) => {
    if (value !== 'conversation' && value !== 'workspace') return;
    changedRef.current = true;
    setSharing(value);
    // Serialize quick switches so the final preference also wins on disk.
    savesRef.current = savesRef.current.then(() => saveJson(STORAGE_KEY, value)).catch(error => {
      console.error('Failed to save workbench sharing preference', error);
    });
  }, []);

  return { workbenchSharing, setWorkbenchSharing, workbenchSharingHydrated };
}

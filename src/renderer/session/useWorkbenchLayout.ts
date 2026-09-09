import { useCallback, useEffect, useRef, useSyncExternalStore, type SetStateAction } from 'react';
import type { OpenPanelOptions, WorkbenchTab } from '../lib/panels';
import { loadJson, saveJson } from '../lib/storage';
import { WorkbenchLayoutStore } from './workbenchLayout';

export function useWorkbenchLayout(scopeKey: string) {
  const storeRef = useRef<WorkbenchLayoutStore | null>(null);
  if (!storeRef.current) storeRef.current = new WorkbenchLayoutStore({ load: key => loadJson(key, null), save: saveJson });
  const store = storeRef.current;
  const getSnapshot = useCallback(() => store.snapshot(scopeKey), [scopeKey, store]);
  const state = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  useEffect(() => { void store.hydrate(scopeKey); }, [scopeKey, store]);
  const setOpen = useCallback((value: SetStateAction<boolean>) => store.update(scopeKey, 'isOpen', value), [scopeKey, store]);
  const setTab = useCallback((value: SetStateAction<WorkbenchTab>) => store.update(scopeKey, 'tab', value), [scopeKey, store]);
  const setTarget = useCallback((value: SetStateAction<OpenPanelOptions>) => store.update(scopeKey, 'target', value), [scopeKey, store]);
  return { ...state, setOpen, setTab, setTarget };
}

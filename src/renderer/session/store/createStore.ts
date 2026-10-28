import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * A value outside React with synchronous reads and writes: code that reads
 * right after it writes (event projection, sends) sees its own write, and
 * components subscribe only to the slice they render (`useStoreSelector`),
 * so a change elsewhere in the value does not re-render them.
 */
export type Store<T> = {
  get: () => T;
  /** Replaces the value; an updater returning the current value is a no-op. */
  set: (next: T | ((current: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === 'function' ? (next as (current: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** The selected slice of `store`; re-renders only when `isEqual` says it
 * changed (identity by default). */
export function useStoreSelector<T, Slice>(
  store: Store<T>,
  select: (value: T) => Slice,
  isEqual: (left: Slice, right: Slice) => boolean = Object.is,
): Slice {
  const selectRef = useRef(select);
  selectRef.current = select;
  const cache = useRef<{ value: T; select: (value: T) => Slice; slice: Slice } | null>(null);
  const getSnapshot = useCallback(() => {
    const value = store.get();
    const select = selectRef.current;
    const cached = cache.current;
    if (cached && cached.value === value && cached.select === select) return cached.slice;
    const next = select(value);
    // An equal slice keeps its identity, so memoized children bail out.
    const slice = cached && isEqual(cached.slice, next) ? cached.slice : next;
    cache.current = { value, select, slice };
    return slice;
  }, [store, isEqual]);
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../preload/index';

/** The main process's update state, live; `null` until the first read. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    const unsubscribe = window.todexDesktop.updates.onState(setState);
    void window.todexDesktop.updates.getState().then((initial) => {
      if (live) setState((current) => current ?? initial);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return state;
}

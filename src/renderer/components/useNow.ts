import { useEffect, useState } from 'react';

const MINUTE = 60_000;

/** Re-renders every `interval` ms while `active`, for countdowns. */
export function useNow(active: boolean, interval = MINUTE): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [active, interval]);
  return now;
}

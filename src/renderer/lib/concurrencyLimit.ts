/**
 * Runs at most `limit` tasks at once; later tasks wait in FIFO order. A
 * finishing task hands its slot straight to the next waiter, so a new caller
 * can never overtake the queue and briefly exceed the limit.
 */
export function createConcurrencyLimit(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

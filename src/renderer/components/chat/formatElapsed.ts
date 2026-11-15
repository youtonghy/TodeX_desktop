const SECOND = 1_000;

/** `12s`, `3m 05s`, `1h 02m`. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / SECOND));
  const pad = (value: number) => String(value).padStart(2, '0');
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

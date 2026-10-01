/** Detects provider "session limit reached" failures that carry a reset wall
 * clock (Claude Code's five-hour window: "You've hit your session limit ·
 * resets 11:30pm (Australia/Perth)") and resolves the reported local time to
 * the next epoch instant in that timezone. */

export type SessionLimitReset = {
  /** Epoch ms of the next occurrence of the reported wall time. */
  until: number;
  /** The reset fragment as reported, e.g. "11:30pm (Australia/Perth)". */
  label: string;
};

// "resets 11:30pm (Australia/Perth)", "reset at 8pm", "resets 11:30 PM".
// Groups: 1 = display label, 2 = hour, 3 = minute, 4 = am/pm, 5 = IANA zone.
const SESSION_LIMIT_RESET =
  /session\s+limit[\s\S]*?\bresets?\s+(?:at\s+)?((\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?(?:\s*\(([^)]+)\))?)/i;

const WALL_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

function wallParts(format: Intl.DateTimeFormat, instant: number) {
  const parts: Record<string, number> = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of format.formatToParts(new Date(instant))) {
    if (part.type in parts) parts[part.type] = Number.parseInt(part.value, 10) || 0;
  }
  return parts;
}

/** Instant whose wall clock in `format`'s zone reads y/m/d h:mi, resolved by
 * fixed-point iteration on the zone offset. Returns null when the wall time
 * cannot be represented (e.g. inside a DST gap). */
function zonedTimeToUtc(
  format: Intl.DateTimeFormat,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = wanted;
  for (let pass = 0; pass < 4; pass += 1) {
    const parts = wallParts(format, instant);
    const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const next = wanted - (wallAsUtc - instant);
    if (next === instant) {
      const check = wallParts(format, instant);
      return check.year === year && check.month === month && check.day === day
        && check.hour === hour && check.minute === minute
        ? instant
        : null;
    }
    instant = next;
  }
  return null;
}

/** Next instant after `now` at which `hour`:`minute` occurs in `timeZone`
 * (local zone when undefined). Checks today and tomorrow in that zone. */
function nextOccurrence(now: number, hour: number, minute: number, timeZone: string | undefined): number | null {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', { ...WALL_FORMAT_OPTIONS, ...(timeZone ? { timeZone } : {}) });
  } catch {
    return null;
  }
  const today = wallParts(format, now);
  for (const offset of [0, 1]) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const instant = zonedTimeToUtc(
      format,
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      hour,
      minute,
    );
    if (instant !== null && instant > now) return instant;
  }
  return null;
}

/** Parses a provider error message for "session limit … resets <time> (<tz>)"
 * and resolves the reset instant. Returns null for non-limit errors and for
 * limit reports whose reset time cannot be understood — callers then keep the
 * generic failure handling. */
export function parseSessionLimitReset(message: string, now: number = Date.now()): SessionLimitReset | null {
  const match = SESSION_LIMIT_RESET.exec(message);
  if (!match) return null;
  const hour12 = Number.parseInt(match[2], 10);
  const minute = match[3] ? Number.parseInt(match[3], 10) : 0;
  const meridiem = match[4].toLowerCase();
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour24 = (hour12 % 12) + (meridiem === 'p' ? 12 : 0);
  const timeZone = match[5]?.trim() || undefined;
  const until = nextOccurrence(now, hour24, minute, timeZone);
  if (until === null) return null;
  return { until, label: match[1].trim() };
}

/** Prefix for the prompt re-queued at the head when a rate limit fails its
 * turn: the interrupted request may already sit in the provider transcript,
 * so the replay frames it as resuming unfinished work rather than issuing a
 * fresh request. Stays English because it is model-facing regardless of the
 * UI locale. */
export function rateLimitContinuationText(text: string): string {
  return `The previous request was interrupted by a provider session limit before it could finish. Continue where it left off and complete the task:\n\n${text}`;
}

/** Validates the persisted conversation → reset map, dropping entries whose
 * wait already elapsed. */
export function restoreRateLimitWaits(value: unknown, now: number = Date.now()): Record<string, SessionLimitReset> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([id, entry]) => {
    if (!entry || typeof entry !== 'object') return [];
    const { until, label } = entry as { until?: unknown; label?: unknown };
    if (typeof until !== 'number' || !Number.isFinite(until) || until <= now) return [];
    if (typeof label !== 'string' || !label) return [];
    return [[id, { until, label }]];
  }));
}

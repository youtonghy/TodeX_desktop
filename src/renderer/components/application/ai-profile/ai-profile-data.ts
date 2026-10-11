/**
 * Layout constants and the fallback tokens series for the AI profile cards
 * (Figma node 4063:5675).
 */

/** Bars track is 206px tall; the tallest design bar is 158px. */
export const AGENTS_TRACK_HEIGHT = 206;
export const AGENTS_MAX_BAR = 158;
/** Days with zero agents render a 4px grey stub (Figma node 4065:8629). */
export const AGENTS_ZERO_BAR = 4;

/**
 * Tokens line — 30 daily values (millions) from Jun 14 to today. Realistic
 * bursty usage: an early session that tails off into a long idle stretch
 * (days 3–11), one isolated spike, a quiet patch with small bumps, then the
 * month's big multi-day push, a cooldown, and a second medium run that eases
 * off at the end.
 */
export const TOKENS_SERIES = [
  34.2, 28.6, 6.1, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 31.4, 4.8, 2.2, 1.1, 5.6, 1.4, 0.8, 42.1,
  51.8, 48.3, 33.6, 9.2, 3.4, 18.7, 25.3, 37.9, 30.2, 24.6,
].map((value, i) => ({ day: i, value }));

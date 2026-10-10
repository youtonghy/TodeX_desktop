import { useSyncExternalStore } from 'react';

// Interface font, bold text and scale. Kept in localStorage (like the locale)
// so the saved look applies synchronously before the first render.

export type Appearance = {
  /** A system font family name; null keeps the bundled Inter. */
  fontFamily: string | null;
  /** Heavier text throughout the interface. */
  boldText: boolean;
  /** Interface scale; 1 is 100%. */
  scale: number;
};

export const DEFAULT_APPEARANCE: Appearance = { fontFamily: null, boldText: false, scale: 1 };
export const APPEARANCE_SCALE_MIN = 0.8;
export const APPEARANCE_SCALE_MAX = 1.5;

const STORAGE_KEY = 'todex.appearance';
const FALLBACK_STACK = '"Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const listeners = new Set<() => void>();
let current = readStoredAppearance();

function clampScale(value: unknown): number {
  const scale = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  return Math.min(APPEARANCE_SCALE_MAX, Math.max(APPEARANCE_SCALE_MIN, Math.round(scale * 20) / 20));
}

function readStoredAppearance(): Appearance {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) as Partial<Appearance> : {};
    const fontFamily = typeof value.fontFamily === 'string' && value.fontFamily.trim() ? value.fontFamily.trim() : null;
    return { fontFamily, boldText: value.boldText === true, scale: clampScale(value.scale) };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '')}"`;
}

/** Applies the appearance to the document root. The scale sets the root font
 * size, which every rem-based size (text, spacing, controls) follows. */
export function applyAppearance(appearance: Appearance = current): void {
  const root = document.documentElement;
  if (appearance.fontFamily) root.style.setProperty('--font-sans', `${quoteFamily(appearance.fontFamily)}, ${FALLBACK_STACK}`);
  else root.style.removeProperty('--font-sans');
  if (appearance.boldText) root.dataset.boldText = 'true';
  else delete root.dataset.boldText;
  root.style.fontSize = appearance.scale === 1 ? '' : `${appearance.scale * 100}%`;
}

export function getAppearance(): Appearance {
  return current;
}

export function updateAppearance(patch: Partial<Appearance>): void {
  current = { ...current, ...patch, scale: clampScale(patch.scale ?? current.scale) };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // The look still applies for this session.
  }
  applyAppearance(current);
  listeners.forEach((listener) => listener());
}

export function useAppearance(): Appearance {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getAppearance);
}

type LocalFontData = { family: string };
type LocalFontWindow = Window & { queryLocalFonts?: () => Promise<LocalFontData[]> };

/** Installed font families, or null where the Local Font Access API is
 * missing or refused (then a typed family name still works). Call it from a
 * user gesture: the first query asks for permission. */
export async function listSystemFonts(): Promise<string[] | null> {
  const query = (window as LocalFontWindow).queryLocalFonts;
  if (!query) return null;
  try {
    const fonts = await query.call(window);
    return [...new Set(fonts.map((font) => font.family).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}

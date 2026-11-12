import { useSyncExternalStore } from 'react';

/** Cards of the home page, in their default order. */
export const HOME_WIDGET_IDS = ['running-count', 'waiting-count', 'today-count', 'today-tokens', 'running', 'waiting', 'limits', 'today', 'hourly', 'shares'] as const;
export type HomeWidgetId = (typeof HOME_WIDGET_IDS)[number];

/** Columns of the home grid at full width; a card spans 1 to all of them. */
export const HOME_COLUMNS = 4;
/** Smallest fixed card height, in pixels. */
export const HOME_MIN_HEIGHT = 96;

export type HomeWidgetLayout = {
  id: HomeWidgetId;
  /** Grid columns the card spans (clamped to the columns on screen). */
  span: number;
  /** Fixed height in pixels; null follows the content. */
  height: number | null;
  /** Removed from the page; it can be added back while customizing. */
  hidden?: boolean;
};

const STORAGE_KEY = 'todex.homeLayout.v1';
const DEFAULT_SPANS: Record<HomeWidgetId, number> = {
  'running-count': 1, 'waiting-count': 1, 'today-count': 1, 'today-tokens': 1,
  running: 2, waiting: 2, limits: 4, today: 4, hourly: 2, shares: 2,
};
const DEFAULTS: HomeWidgetLayout[] = HOME_WIDGET_IDS.map((id) => ({ id, span: DEFAULT_SPANS[id], height: null }));

export const isHomeWidgetId = (value: unknown): value is HomeWidgetId => HOME_WIDGET_IDS.includes(value as HomeWidgetId);

/** Saved cards in their saved order, then any card the saved layout lacks. */
function normalize(saved: unknown): HomeWidgetLayout[] {
  const seen = new Set<HomeWidgetId>();
  const layout: HomeWidgetLayout[] = [];
  for (const item of Array.isArray(saved) ? saved : []) {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    if (!isHomeWidgetId(record.id) || seen.has(record.id)) continue;
    seen.add(record.id);
    layout.push({
      id: record.id,
      span: typeof record.span === 'number' ? Math.min(HOME_COLUMNS, Math.max(1, Math.round(record.span))) : DEFAULT_SPANS[record.id],
      height: typeof record.height === 'number' && Number.isFinite(record.height) ? Math.max(HOME_MIN_HEIGHT, Math.round(record.height)) : null,
      ...(record.hidden === true ? { hidden: true } : {}),
    });
  }
  return [...layout, ...DEFAULTS.filter((item) => !seen.has(item.id))];
}

function read(): HomeWidgetLayout[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

// One shared snapshot, so every window's home page agrees.
let layout = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window (or tab, on the web) changed the layout.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    layout = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setHomeLayout(next: HomeWidgetLayout[]) {
  layout = normalize(next);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch { /* Storage may be disabled. */ }
  listeners.forEach((listener) => listener());
}

export function resetHomeLayout() {
  layout = DEFAULTS;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
  listeners.forEach((listener) => listener());
}

/** Per-device order, size and visibility of the home cards; never synced to the backend. */
export function useHomeLayout(): HomeWidgetLayout[] {
  return useSyncExternalStore(subscribe, () => layout);
}

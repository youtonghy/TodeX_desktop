export const SUPPORTED_LOCALES = ['zh-CN', 'en', 'ja', 'ko'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = Locale | 'auto';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'todex.locale';
export const LOCALE_QUERY_PARAM = 'lang';

// Native-language labels shown in every language switcher; never translated.
export const LOCALE_LABELS: Record<Locale, string> = { 'zh-CN': '简体中文', en: 'English', ja: '日本語', ko: '한국어' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// Maps a BCP 47 tag to a supported locale. Every Chinese variant (zh-TW, zh-HK,
// zh-Hant, ...) is served as Simplified Chinese; unknown languages return null.
export function matchLocale(tag: string | null | undefined): Locale | null {
  const language = tag?.trim().toLowerCase().split(/[-_]/)[0];
  switch (language) {
    case 'zh': return 'zh-CN';
    case 'en': return 'en';
    case 'ja': return 'ja';
    case 'ko': return 'ko';
    default: return null;
  }
}

export function resolveLocale(candidates: readonly (string | null | undefined)[]): Locale {
  for (const candidate of candidates) {
    const locale = matchLocale(candidate);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function readStoredLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale | null): void {
  try {
    if (locale) window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    else window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    // A blocked storage only loses the preference for the next visit.
  }
}

export type DetectLocaleInput = {
  search?: string;
  stored?: Locale | null;
  languages?: readonly string[];
};

// Precedence: one-off ?lang= override, then the saved preference, then the
// browser/system language list in preference order, then English.
export function detectLocale(input: DetectLocaleInput = {}): Locale {
  const hasWindow = typeof window !== 'undefined';
  const search = input.search ?? (hasWindow ? window.location.search : '');
  const requested = new URLSearchParams(search).get(LOCALE_QUERY_PARAM);
  if (requested) {
    const locale = matchLocale(requested);
    if (locale) return locale;
  }
  const stored = input.stored !== undefined ? input.stored : hasWindow ? readStoredLocale() : null;
  if (stored) return stored;
  const languages = input.languages ?? (typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []);
  return resolveLocale(languages);
}

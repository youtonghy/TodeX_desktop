import { useSyncExternalStore } from 'react';
import { messages, type MessageKey } from './messages';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, detectLocale, readStoredLocale, writeStoredLocale, type Locale, type LocalePreference } from './locales';

export { LOCALE_LABELS, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, detectLocale, isLocale, matchLocale, resolveLocale } from './locales';
export type { Locale, LocalePreference } from './locales';
export type { MessageKey } from './messages';

export type MessageParams = Record<string, string | number>;

const listeners = new Set<() => void>();
const pluralRules = new Map<Locale, Intl.PluralRules>();
let currentLocale: Locale = detectLocale();
syncDocumentLanguage(currentLocale);

function syncDocumentLanguage(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function getLocalePreference(): LocalePreference {
  return readStoredLocale() ?? 'auto';
}

// Switches the active language for the whole app without touching the saved
// preference; every subscriber (React via useLocale, plain modules via
// subscribeLocale) is notified synchronously.
export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  syncDocumentLanguage(locale);
  listeners.forEach((listener) => listener());
}

// 'auto' clears the saved choice and re-detects from the browser/system.
export function setLocalePreference(preference: LocalePreference): void {
  writeStoredLocale(preference === 'auto' ? null : preference);
  setLocale(preference === 'auto' ? detectLocale({ search: '' }) : preference);
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

// Minimal ICU subset: {name} interpolation and
// {count, plural, one {# file} other {# files}} with '#' as the number.
function format(template: string, locale: Locale, params?: MessageParams): string {
  if (!params) return template;
  return template
    .replace(/\{(\w+),\s*plural,((?:\s*\w+\s*\{[^{}]*\})+)\s*\}/g, (_match, name: string, branches: string) => {
      const value = Number(params[name]);
      const options = new Map<string, string>();
      for (const branch of branches.matchAll(/(\w+)\s*\{([^{}]*)\}/g)) options.set(branch[1], branch[2]);
      const text = options.get(`=${value}`) ?? options.get(pluralCategory(locale, value)) ?? options.get('other') ?? '';
      return text.replace(/#/g, String(params[name]));
    })
    .replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const template = messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? messages['zh-CN'][key] ?? key;
  return format(template, locale, params);
}

export function t(key: MessageKey, params?: MessageParams): string {
  return translate(currentLocale, key, params);
}

// Returns true when `text` equals any locale's raw value for `key`. Used to
// recognize localized sentinel strings (e.g. default conversation titles)
// regardless of the locale that produced them.
export function matchesMessage(key: MessageKey, text: string): boolean {
  const trimmed = text.trim();
  return SUPPORTED_LOCALES.some((locale) => messages[locale][key] === trimmed);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

// Components call useT() so they re-render when the language changes; plain
// modules (session hooks, helpers) call t() directly.
export function useT(): typeof t {
  useLocale();
  return t;
}

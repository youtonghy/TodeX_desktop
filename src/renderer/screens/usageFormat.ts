import { getLocale } from '../i18n';

export function formatTokens(value: number): string {
  return new Intl.NumberFormat(getLocale(), {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Local calendar day key, YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

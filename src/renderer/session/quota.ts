import type { UsageLimit } from '@/components/application/agent-limits/agent-limits-card';
import type { ProviderQuotaSnapshot, QuotaWindow } from '@todex/protocol/v2';
import { getLocale, t, type MessageKey } from '../i18n';

// Plan quota windows (GET /v2/providers/quota) as agent-limits rows, shared
// by the quota dialog and the composer's context popover.

const QUOTA_WINDOW_KEYS: Record<string, MessageKey> = {
  primary: 'usage.quotaWindow.primary',
  secondary: 'usage.quotaWindow.secondary',
  five_hour: 'usage.quotaWindow.five_hour',
  seven_day: 'usage.quotaWindow.seven_day',
  'gemini-weekly': 'usage.quotaWindow.gemini_weekly',
  'gemini-5h': 'usage.quotaWindow.gemini_5h',
  '3p-weekly': 'usage.quotaWindow.third_party_weekly',
  '3p-5h': 'usage.quotaWindow.third_party_5h',
};

export function quotaWindowLabel(window: QuotaWindow): string {
  const key = QUOTA_WINDOW_KEYS[window.id];
  if (key) return t(key);
  return window.id;
}

function formatQuotaTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(getLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Quota window as an agent-limits plan row; the bar turns amber at 75% and red at 90%. */
export function quotaLimit(window: QuotaWindow): UsageLimit {
  const percent = typeof window.usedPercent === 'number' ? Math.min(100, Math.max(0, window.usedPercent)) : null;
  return {
    label: quotaWindowLabel(window),
    used: (percent ?? 0) / 100,
    resets: window.resetsAt ? t('usage.quotaResets', { time: formatQuotaTime(window.resetsAt) }) : '',
    valueLabel: percent === null ? '—' : undefined,
    color: percent !== null && percent >= 90 ? 'var(--color-foreground-icon-error)' : percent !== null && percent >= 75 ? 'var(--color-chart-8)' : undefined,
  };
}


/** The snapshot's windows as plan rows (none unless the provider reported). */
export function quotaLimits(snapshot: ProviderQuotaSnapshot): UsageLimit[] {
  if (snapshot.state !== 'ok') return [];
  return (snapshot.windows ?? []).filter((window) => window && typeof window.id === 'string').map(quotaLimit);
}

/** What the plan section says when there are no rows. */
export function quotaMessage(snapshot: ProviderQuotaSnapshot): string {
  return snapshot.state === 'ok'
    ? t('usage.quotaNoWindows')
    : snapshot.state === 'unsupported'
      ? t('usage.quotaUnsupported')
      : snapshot.state === 'idle'
        ? t('usage.quotaIdle')
        : t('usage.quotaError', { reason: snapshot.reason ?? '—' });
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Chip } from '@heroui/react';
import { RiRefreshLine, RiVipCrownLine } from '@remixicon/react';
import type { ProviderQuotaSnapshot, QuotaWindow } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { ProviderIcon } from '../components/ProviderIcon';
import { getLocale, t, useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { backendApi } from '../session/helpers';

type Props = {
  session: TodeXSession;
};

// Account-level plan quota (GET /v2/providers/quota), refreshed while the
// panel is open. Claude Code only reports during a turn, so its card may sit
// in the idle state until a session runs. Devin's ACP exposes no plan-quota
// surface today, so it is filtered out of the display order.
const QUOTA_REFRESH_MS = 60_000;
const QUOTA_PROVIDER_ORDER = ['codex', 'claude-code'];
const QUOTA_HIDDEN_PROVIDERS = new Set(['devin']);
const QUOTA_WINDOW_KEYS: Record<string, MessageKey> = {
  primary: 'usage.quotaWindow.primary',
  secondary: 'usage.quotaWindow.secondary',
  five_hour: 'usage.quotaWindow.five_hour',
  seven_day: 'usage.quotaWindow.seven_day',
};

function quotaWindowLabel(window: QuotaWindow): string {
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

function QuotaWindowRow({ window }: { window: QuotaWindow }) {
  const percent = typeof window.usedPercent === 'number' ? Math.min(100, Math.max(0, window.usedPercent)) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted text-xs">{quotaWindowLabel(window)}</span>
        <span className="text-xs tabular-nums">
          {percent === null ? '—' : t('usage.quotaUsed', { percent: Math.round(percent) })}
        </span>
      </div>
      <div className="bg-surface-secondary h-1.5 w-full overflow-hidden rounded-full" aria-hidden={percent === null}>
        <div className="bg-accent h-full" style={{ width: `${percent ?? 0}%` }} />
      </div>
      {window.resetsAt ? (
        <span className="text-muted text-[11px]">{t('usage.quotaResets', { time: formatQuotaTime(window.resetsAt) })}</span>
      ) : null}
    </div>
  );
}

function QuotaCard({ snapshot, displayName }: { snapshot: ProviderQuotaSnapshot; displayName: string }) {
  const windows = (snapshot.windows ?? []).filter((window) => window && typeof window.id === 'string');
  const fetchedAt = typeof snapshot.fetchedAt === 'number' ? new Date(snapshot.fetchedAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <Card className="min-w-0 p-4">
      <div className="flex items-center gap-2">
        <ProviderIcon provider={snapshot.provider} className="size-4" />
        <span className="truncate text-sm font-medium">{displayName}</span>
        {snapshot.planType ? <Chip size="sm" variant="soft" className="capitalize">{snapshot.planType}</Chip> : null}
        {fetchedAt ? <span className="text-muted ml-auto shrink-0 text-[11px]">{t('usage.quotaUpdated', { time: fetchedAt })}</span> : null}
      </div>
      {snapshot.state === 'ok' ? (
        <div className="mt-3 flex flex-col gap-3">
          {windows.map((window) => <QuotaWindowRow key={window.id} window={window} />)}
          {windows.length === 0 ? <p className="text-muted text-xs">{t('usage.quotaIdle')}</p> : null}
        </div>
      ) : (
        <p className="text-muted mt-3 text-xs">
          {snapshot.state === 'unsupported'
            ? t('usage.quotaUnsupported')
            : snapshot.state === 'idle'
              ? t('usage.quotaIdle')
              : t('usage.quotaError', { reason: snapshot.reason ?? '—' })}
        </p>
      )}
    </Card>
  );
}

export function QuotaPanel({ session }: Props) {
  useT();
  const [snapshots, setSnapshots] = useState<Record<string, ProviderQuotaSnapshot>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const api = backendApi(session.settings);
      const response = await api.getProviderQuotas();
      setSnapshots(response.providers ?? {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [session.settings.serverUrl, session.settings.deviceSecret]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), QUOTA_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const ordered = useMemo(() => {
    const entries = Object.values(snapshots).filter((snapshot) => !QUOTA_HIDDEN_PROVIDERS.has(snapshot.provider));
    entries.sort((a, b) => {
      const rank = (id: string) => {
        const index = QUOTA_PROVIDER_ORDER.indexOf(id);
        return index === -1 ? QUOTA_PROVIDER_ORDER.length : index;
      };
      return rank(a.provider) - rank(b.provider) || a.provider.localeCompare(b.provider);
    });
    return entries;
  }, [snapshots]);

  const displayName = (provider: string) => {
    const descriptor = session.v2Providers.find((item) => item.id === provider);
    return descriptor?.displayName ?? provider;
  };

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('usage.quotaTitle')}</h2>
          <p className="text-muted mt-1 text-sm">{t('usage.quotaHint')}</p>
        </div>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={() => void refresh()}>
          <RiRefreshLine className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          {t('usage.quotaRefresh')}
        </Button>
      </div>
      {error ? <p className="text-danger text-xs">{t('usage.quotaError', { reason: error })}</p> : null}
      {ordered.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {ordered.map((snapshot) => <QuotaCard key={snapshot.provider} snapshot={snapshot} displayName={displayName(snapshot.provider)} />)}
        </div>
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center text-center">
          <RiVipCrownLine className="text-muted size-7" />
          <p className="mt-3 text-sm font-medium">{t(error ? 'usage.quotaError' : 'usage.quotaLoading', { reason: error ?? '' })}</p>
        </div>
      )}
    </div>
  );
}

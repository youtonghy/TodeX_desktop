import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Chip, Label, ListBox, Select } from '@heroui/react';
import { RiBarChartBoxLine, RiDatabase2Line, RiDownloadCloud2Line, RiFlashlightLine, RiRefreshLine, RiUploadCloud2Line } from '@remixicon/react';
import { usageTotalTokens } from '@todex/protocol/conversationRuntime';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { V2ApiClient } from '@todex/protocol/v2';
import type { ProviderQuotaSnapshot, QuotaWindow } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { ProviderIcon } from '../components/ProviderIcon';
import { getLocale, t, useT } from '../i18n';
import type { MessageKey } from '../i18n';
import type { UsageRecord } from '../session/helpers';

type Props = {
  session: TodeXSession;
};

type UsageTotals = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

const EMPTY_TOTALS: UsageTotals = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
};

function totalOf(record: UsageRecord): number {
  return usageTotalTokens(record);
}

function addUsage(current: UsageTotals, record: UsageRecord): UsageTotals {
  return {
    totalTokens: current.totalTokens + totalOf(record),
    inputTokens: current.inputTokens + record.inputTokens,
    outputTokens: current.outputTokens + record.outputTokens,
    cachedInputTokens: current.cachedInputTokens + record.cachedInputTokens,
    cacheWriteTokens: current.cacheWriteTokens + record.cacheWriteTokens,
  };
}

function sum(records: UsageRecord[]): UsageTotals {
  return records.reduce(addUsage, EMPTY_TOTALS);
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(getLocale(), {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function titleCase(value: string): string {
  return value === 'unknown' ? t('usage.unknown') : value.charAt(0).toUpperCase() + value.slice(1);
}

function MetricCard({ label, value, detail, icon: Icon, tone }: {
  label: string;
  value: number;
  detail: string;
  icon: typeof RiBarChartBoxLine;
  tone: string;
}) {
  return (
    <Card className="min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted text-xs">{label}</p>
          <p className="mt-1 truncate text-xl font-semibold tabular-nums">{formatTokens(value)}</p>
          <p className="text-muted mt-1 text-xs">{detail}</p>
        </div>
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </div>
    </Card>
  );
}

function UsageBar({ label, totals, max }: { label: string; totals: UsageTotals; max: number }) {
  const total = totals.totalTokens;
  return (
    <div className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(10rem,2fr)_4rem] items-center gap-3">
      <span className="truncate text-sm font-medium" title={label}>{label}</span>
      <div className="bg-surface-secondary h-3 overflow-hidden rounded-sm" style={{ width: `${max ? Math.max((total / max) * 100, 2) : 0}%` }}>
        <div className="bg-accent h-full w-full" />
      </div>
      <span className="text-muted text-right text-xs tabular-nums">{formatTokens(total)}</span>
    </div>
  );
}

// Account-level plan quota (GET /v2/providers/quota), refreshed while the
// panel is open. Claude Code only reports during a turn, so its card may sit
// in the idle state until a session runs.
const QUOTA_REFRESH_MS = 60_000;
const QUOTA_PROVIDER_ORDER = ['codex', 'claude-code', 'devin'];
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

function QuotaSection({ session }: Props) {
  const [snapshots, setSnapshots] = useState<Record<string, ProviderQuotaSnapshot>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const api = new V2ApiClient({
        serverUrl: session.settings.serverUrl,
        device: deviceIdentityFromSecret(session.settings.deviceSecret),
      });
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
    const entries = Object.values(snapshots);
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
    return descriptor?.displayName ?? titleCase(provider);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t('usage.quotaTitle')}</h3>
          <p className="text-muted mt-1 text-xs">{t('usage.quotaHint')}</p>
        </div>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={() => void refresh()}>
          <RiRefreshLine className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          {t('usage.quotaRefresh')}
        </Button>
      </div>
      {error ? <p className="text-danger text-xs">{t('usage.quotaError', { reason: error })}</p> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((snapshot) => <QuotaCard key={snapshot.provider} snapshot={snapshot} displayName={displayName(snapshot.provider)} />)}
      </div>
      {ordered.length === 0 && !error ? <p className="text-muted text-xs">{t('usage.quotaLoading')}</p> : null}
    </section>
  );
}

export function UsagePanel({ session }: Props) {
  const t = useT();
  const [provider, setProvider] = useState('all');
  const [model, setModel] = useState('all');
  const providers = useMemo(() => [...new Set(session.usageRecords.map((record) => record.provider))].sort(), [session.usageRecords]);
  const providerRecords = useMemo(
    () => provider === 'all' ? session.usageRecords : session.usageRecords.filter((record) => record.provider === provider),
    [provider, session.usageRecords],
  );
  const models = useMemo(() => [...new Set(providerRecords.map((record) => record.model))].sort(), [providerRecords]);
  const filtered = useMemo(
    () => model === 'all' ? providerRecords : providerRecords.filter((record) => record.model === model),
    [model, providerRecords],
  );
  const totals = useMemo(() => sum(filtered), [filtered]);
  const totalTokens = totals.totalTokens;
  const knownCacheRecords = filtered.filter(record => record.cacheSemantics === 'included' || record.cacheSemantics === 'additional');
  const cacheBase = knownCacheRecords.reduce((total, record) => total + record.inputTokens
    + (record.cacheSemantics === 'additional' ? record.cachedInputTokens + record.cacheWriteTokens : 0), 0);
  const cacheRead = knownCacheRecords.reduce((total, record) => total + record.cachedInputTokens, 0);
  const cacheRate = cacheBase ? Math.min(100, Math.round((cacheRead / cacheBase) * 100)) : null;
  const byProvider = useMemo(() => {
    const values = new Map<string, UsageRecord[]>();
    for (const record of filtered) values.set(record.provider, [...(values.get(record.provider) ?? []), record]);
    return [...values].map(([name, records]) => ({ name: titleCase(name), totals: sum(records) })).sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
  }, [filtered]);
  const byModel = useMemo(() => {
    const values = new Map<string, UsageRecord[]>();
    for (const record of filtered) values.set(record.model, [...(values.get(record.model) ?? []), record]);
    return [...values].map(([name, records]) => ({ name, totals: sum(records) })).sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
  }, [filtered]);
  const chartRows = provider === 'all' ? byProvider : byModel;
  const chartMax = Math.max(0, ...chartRows.map((row) => row.totals.totalTokens));

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-xl font-semibold">{t('usage.title')}</h2>
          <p className="text-muted mt-1 text-sm">{t('usage.subtitle')}</p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <Select selectedKey={provider} onSelectionChange={(key) => { if (typeof key === 'string') { setProvider(key); setModel('all'); } }}>
            <Label>Agent</Label>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox><ListBox.Item id="all" textValue={t('usage.allAgents')}>{t('usage.allAgents')}</ListBox.Item>{providers.map((item) => <ListBox.Item key={item} id={item} textValue={titleCase(item)}>{titleCase(item)}</ListBox.Item>)}</ListBox></Select.Popover>
          </Select>
          <Select selectedKey={models.includes(model) ? model : 'all'} onSelectionChange={(key) => { if (typeof key === 'string') setModel(key); }}>
            <Label>{t('usage.modelLabel')}</Label>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox><ListBox.Item id="all" textValue={t('usage.allModels')}>{t('usage.allModels')}</ListBox.Item>{models.map((item) => <ListBox.Item key={item} id={item} textValue={item}>{item}</ListBox.Item>)}</ListBox></Select.Popover>
          </Select>
        </div>
      </div>

      <QuotaSection session={session} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label={t('usage.totalLabel')} value={totalTokens} detail={t('usage.recordCount', { count: filtered.length })} icon={RiBarChartBoxLine} tone="bg-accent-soft text-accent" />
        <MetricCard label={t('usage.inputLabel')} value={totals.inputTokens} detail={t('usage.inputDetail')} icon={RiDownloadCloud2Line} tone="bg-success-soft text-success" />
        <MetricCard label={t('usage.outputLabel')} value={totals.outputTokens} detail={t('usage.outputDetail')} icon={RiUploadCloud2Line} tone="bg-primary-soft text-primary" />
        <MetricCard label={t('usage.cacheReadLabel')} value={totals.cachedInputTokens} detail={cacheRate === null ? t('usage.cacheSemanticsPending') : t('usage.cacheHitRate', { rate: cacheRate })} icon={RiFlashlightLine} tone="bg-warning-soft text-warning" />
        <MetricCard label={t('usage.cacheWriteLabel')} value={totals.cacheWriteTokens} detail={t('usage.cacheWriteDetail')} icon={RiDatabase2Line} tone="bg-surface-secondary text-muted" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <Card className="p-5">
          <div className="mb-5">
            <h3 className="font-semibold">{provider === 'all' ? t('usage.byAgent') : t('usage.byModel')}</h3>
            <p className="text-muted mt-1 text-xs">{t('usage.chartHint')}</p>
          </div>
          {chartRows.length ? (
            <div className="flex flex-col gap-4">
              {chartRows.slice(0, 12).map((row) => <UsageBar key={row.name} label={row.name} totals={row.totals} max={chartMax} />)}
            </div>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <RiBarChartBoxLine className="text-muted size-7" />
              <p className="mt-3 text-sm font-medium">{t('usage.emptyTitle')}</p>
              <p className="text-muted mt-1 max-w-sm text-xs">{t('usage.emptyHint')}</p>
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">{t('usage.cacheComposition')}</h3>
          <p className="text-muted mt-1 text-xs">{t('usage.cacheHint')}</p>
          <div className="mt-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-semibold tabular-nums">{cacheRate === null ? '—' : `${cacheRate}%`}</p>
              <p className="text-muted mt-1 text-xs">{t('usage.cacheHitRateLabel')}</p>
            </div>
            <div className="bg-surface-secondary flex h-24 w-16 items-end overflow-hidden rounded-sm" aria-label={cacheRate === null ? t('usage.cacheSemanticsPending') : t('usage.cacheHitRateAria', { rate: cacheRate })}>
              <div className="bg-warning w-full" style={{ height: `${cacheRate ?? 0}%` }} />
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-3 text-xs">
            <div><dt className="text-muted">{t('usage.lastUpdate')}</dt><dd className="mt-1 font-medium">{filtered[0] ? new Date(filtered[0].updatedAt).toLocaleString(getLocale()) : t('usage.none')}</dd></div>
            <div><dt className="text-muted">{t('usage.modelCount')}</dt><dd className="mt-1 font-medium">{new Set(filtered.map((record) => record.model)).size}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

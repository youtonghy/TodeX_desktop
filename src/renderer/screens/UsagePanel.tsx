import { useEffect, useMemo, useState } from 'react';
import { RiBarChartBoxLine, RiDatabase2Line, RiDownloadCloud2Line, RiFlashlightLine, RiUploadCloud2Line } from '@remixicon/react';
import { usageTotalTokens } from '@todex/protocol/conversationRuntime';
import { Select, SelectItem } from '@/components/base/select/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Meter } from '@/components/ui/progress-bar';
import type { TodeXSession } from '../session/useTodeXSession';
import { getLocale, t, useT } from '../i18n';
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

// BoardUI plain stat card: the icon tile sits above the label so the value
// gets the card's full width; a side tile left five-up cards too narrow and
// truncated large totals.
function MetricCard({ label, value, detail, icon: Icon }: {
  label: string;
  value: number;
  detail: string;
  icon: typeof RiBarChartBoxLine;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-2xl bg-background-secondary-default p-4">
      <span className="flex w-fit items-center rounded-md bg-stat-card-icon-background p-1.5">
        <Icon className="size-5 shrink-0 text-foreground-icon-primary" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-body-medium text-text-secondary">{label}</p>
        <p className="truncate text-title-1-medium text-text-primary tabular-nums">{formatTokens(value)}</p>
        <p className="text-caption-1-regular text-text-tertiary">{detail}</p>
      </div>
    </section>
  );
}

/** Bars mount at zero and grow in (a timeout so the first frame is painted). */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(timer);
  }, []);
  return mounted;
}

// BoardUI bar-list row: a translucent chart-6 bar sized against the top row
// sits behind the label with the total on the right; hover deepens the tint.
function UsageBar({ label, totals, max, mounted }: { label: string; totals: UsageTotals; max: number; mounted: boolean }) {
  const [active, setActive] = useState(false);
  const total = totals.totalTokens;
  const width = max ? Math.max((total / max) * 100, 2) : 0;
  return (
    <div
      className="relative flex h-9 items-center justify-between gap-3 rounded-lg px-2.5"
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 start-0 rounded-lg transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
        style={{
          width: mounted ? `${width}%` : 0,
          backgroundColor: `color-mix(in srgb, ${active ? 'var(--color-chart-6-active)' : 'var(--color-chart-6)'} ${active ? 26 : 14}%, transparent)`,
        }}
      />
      <span className="relative min-w-0 truncate text-body-regular text-text-primary" title={label}>{label}</span>
      <span className="relative shrink-0 text-body-medium text-text-primary tabular-nums">{formatTokens(total)}</span>
    </div>
  );
}

export function UsagePanel({ session }: Props) {
  const t = useT();
  const [provider, setProvider] = useState('all');
  const [model, setModel] = useState('all');
  const mounted = useMounted();
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
    <div className="flex flex-col gap-5 py-1">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <p className="text-body-regular text-text-secondary">{t('usage.subtitle')}</p>
        <div className="grid min-w-0 shrink-0 grid-cols-1 gap-3 sm:w-96 sm:grid-cols-2">
          <Select
            aria-label="Agent"
            className="w-full min-w-0"
            selectedKey={provider}
            onSelectionChange={(key) => { if (typeof key === 'string') { setProvider(key); setModel('all'); } }}
          >
            <SelectItem id="all" textValue={t('usage.allAgents')}>{t('usage.allAgents')}</SelectItem>
            {providers.map((item) => <SelectItem key={item} id={item} textValue={titleCase(item)}>{titleCase(item)}</SelectItem>)}
          </Select>
          <Select
            aria-label={t('usage.modelLabel')}
            className="w-full min-w-0"
            selectedKey={models.includes(model) ? model : 'all'}
            onSelectionChange={(key) => { if (typeof key === 'string') setModel(key); }}
          >
            <SelectItem id="all" textValue={t('usage.allModels')}>{t('usage.allModels')}</SelectItem>
            {models.map((item) => <SelectItem key={item} id={item} textValue={item}>{item}</SelectItem>)}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label={t('usage.totalLabel')} value={totalTokens} detail={t('usage.recordCount', { count: filtered.length })} icon={RiBarChartBoxLine} />
        <MetricCard label={t('usage.inputLabel')} value={totals.inputTokens} detail={t('usage.inputDetail')} icon={RiDownloadCloud2Line} />
        <MetricCard label={t('usage.outputLabel')} value={totals.outputTokens} detail={t('usage.outputDetail')} icon={RiUploadCloud2Line} />
        <MetricCard label={t('usage.cacheReadLabel')} value={totals.cachedInputTokens} detail={cacheRate === null ? t('usage.cacheSemanticsPending') : t('usage.cacheHitRate', { rate: cacheRate })} icon={RiFlashlightLine} />
        <MetricCard label={t('usage.cacheWriteLabel')} value={totals.cacheWriteTokens} detail={t('usage.cacheWriteDetail')} icon={RiDatabase2Line} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <section className="flex min-w-0 flex-col rounded-2xl bg-background-secondary-default px-4 pb-3">
          <div className="-mx-4 mb-3 flex flex-col gap-0.5 border-b border-separator-border px-4 pt-4 pb-3">
            <h3 className="text-body-medium text-text-primary">{provider === 'all' ? t('usage.byAgent') : t('usage.byModel')}</h3>
            <p className="text-body-2-regular text-text-secondary">{t('usage.chartHint')}</p>
          </div>
          {chartRows.length ? (
            <div className="-mx-2 flex flex-col gap-1">
              {chartRows.slice(0, 12).map((row) => <UsageBar key={row.name} label={row.name} totals={row.totals} max={chartMax} mounted={mounted} />)}
            </div>
          ) : (
            <EmptyState className="min-h-48" icon={RiBarChartBoxLine} title={t('usage.emptyTitle')} description={t('usage.emptyHint')} />
          )}
        </section>
        <section className="flex min-w-0 flex-col rounded-2xl bg-background-secondary-default p-4">
          <h3 className="text-body-medium text-text-primary">{t('usage.cacheComposition')}</h3>
          <p className="mt-0.5 text-body-2-regular text-text-secondary">{t('usage.cacheHint')}</p>
          <div className="mt-6 flex flex-col gap-1">
            <p className="text-display-4-medium text-text-primary tabular-nums">{cacheRate === null ? '—' : `${cacheRate}%`}</p>
            <p className="text-caption-1-regular text-text-secondary">{t('usage.cacheHitRateLabel')}</p>
            {cacheRate === null ? null : (
              <Meter className="mt-2" aria-label={t('usage.cacheHitRateLabel')} showValue={false} value={cacheRate} />
            )}
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-3 border-t border-separator-border pt-4">
            <div className="min-w-0"><dt className="text-caption-1-regular text-text-secondary">{t('usage.lastUpdate')}</dt><dd className="mt-1 text-body-2-medium text-text-primary">{filtered[0] ? new Date(filtered[0].updatedAt).toLocaleString(getLocale()) : t('usage.none')}</dd></div>
            <div className="min-w-0"><dt className="text-caption-1-regular text-text-secondary">{t('usage.modelCount')}</dt><dd className="mt-1 text-body-2-medium text-text-primary tabular-nums">{new Set(filtered.map((record) => record.model)).size}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

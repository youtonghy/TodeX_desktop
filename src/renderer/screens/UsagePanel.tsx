import { useMemo, useState } from 'react';
import { Card, Label, ListBox, Select } from '@heroui/react';
import { RiBarChartBoxLine, RiDatabase2Line, RiDownloadCloud2Line, RiFlashlightLine, RiUploadCloud2Line } from '@remixicon/react';
import { usageTotalTokens } from '@todex/protocol/conversationRuntime';
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

import { useEffect, useMemo, useState } from 'react';
import { RiBarChartBoxLine } from '@remixicon/react';
import { usageTotalTokens } from '@todex/protocol/conversationRuntime';
import { AgentsChartCard } from '@/components/application/ai-profile/agents-chart-card';
import { AiProfileCard } from '@/components/application/ai-profile/ai-profile-card';
import { TokensChartCard } from '@/components/application/ai-profile/tokens-chart-card';
import type { ContributionCell } from '@/components/application/dashboard/contributions-card';
import { Badge } from '@/components/base/badges/badge';
import { Chip } from '@/components/base/badges/chip';
import { Select, SelectItem } from '@/components/base/select/select';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppIcon } from '../components/AppIcon';
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

/** The activity heatmap: 38 week columns × 7 weekday rows, ending this week. */
const HEATMAP_WEEKS = 38;
const DAY_MS = 86_400_000;

function addUsage(current: UsageTotals, record: UsageRecord): UsageTotals {
  return {
    totalTokens: current.totalTokens + usageTotalTokens(record),
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

/** Local calendar day key, YYYY-MM-DD. */
function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
}

/** Daily token totals and the conversations seen each day. */
function dailyUsage(records: UsageRecord[]) {
  const tokens = new Map<string, number>();
  const conversations = new Map<string, Set<string>>();
  for (const record of records) {
    const key = dayKey(new Date(record.updatedAt));
    tokens.set(key, (tokens.get(key) ?? 0) + usageTotalTokens(record));
    let seen = conversations.get(key);
    if (!seen) conversations.set(key, seen = new Set());
    seen.add(record.conversationId);
  }
  return { tokens, conversations };
}

/** Heatmap cells: weekday rows × week columns, tiers by quintile of the busy days. */
function heatmapCells(tokens: Map<string, number>, today: Date): ContributionCell[][] {
  const end = startOfDay(today);
  const firstColumnStart = new Date(end.getTime() - ((HEATMAP_WEEKS - 1) * 7 + end.getDay()) * DAY_MS);
  const busy = [...tokens.values()].filter((value) => value > 0).sort((a, b) => a - b);
  const tierOf = (value: number) => {
    if (value <= 0 || !busy.length) return 0;
    const rank = busy.findIndex((item) => item >= value);
    return Math.min(5, 1 + Math.floor(((rank < 0 ? busy.length - 1 : rank) / busy.length) * 5));
  };
  return Array.from({ length: 7 }, (_, row) => Array.from({ length: HEATMAP_WEEKS }, (_, col) => {
    const date = new Date(firstColumnStart.getFullYear(), firstColumnStart.getMonth(), firstColumnStart.getDate() + col * 7 + row);
    if (date > end) return { tier: 0, label: shortDate(date) };
    const value = tokens.get(dayKey(date)) ?? 0;
    return {
      tier: tierOf(value),
      label: value ? t('usage.dayTokens', { date: shortDate(date), tokens: formatTokens(value) }) : t('usage.dayNone', { date: shortDate(date) }),
    };
  }));
}

/** The user's profile page, in place of the conversation: usage on the
 * BoardUI AI profile template — the profile card with totals and the
 * activity heatmap, active conversations per day for a month beside the
 * token trend of the last 30 days, and the per-agent / per-model breakdown. */
export function ProfilePanel({ session }: Props) {
  const t = useT();
  const [provider, setProvider] = useState('all');
  const [model, setModel] = useState('all');
  const [monthOffset, setMonthOffset] = useState(0);
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
  const knownCacheRecords = filtered.filter(record => record.cacheSemantics === 'included' || record.cacheSemantics === 'additional');
  const cacheBase = knownCacheRecords.reduce((total, record) => total + record.inputTokens
    + (record.cacheSemantics === 'additional' ? record.cachedInputTokens + record.cacheWriteTokens : 0), 0);
  const cacheRead = knownCacheRecords.reduce((total, record) => total + record.cachedInputTokens, 0);
  const cacheRate = cacheBase ? Math.min(100, Math.round((cacheRead / cacheBase) * 100)) : null;
  const breakdown = useMemo(() => {
    const key = (record: UsageRecord) => provider === 'all' ? record.provider : record.model;
    const values = new Map<string, UsageRecord[]>();
    for (const record of filtered) values.set(key(record), [...(values.get(key(record)) ?? []), record]);
    return [...values]
      .map(([name, records]) => ({ name: provider === 'all' ? titleCase(name) : name, total: sum(records).totalTokens }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, provider]);
  const breakdownMax = Math.max(0, ...breakdown.map((row) => row.total));

  const today = useMemo(() => new Date(), []);
  const daily = useMemo(() => dailyUsage(filtered), [filtered]);
  const cells = useMemo(() => heatmapCells(daily.tokens, today), [daily, today]);

  // Active conversations per day for the selected month.
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const dayDates = Array.from({ length: monthDays }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
  const conversationDays = dayDates.map((date) => daily.conversations.get(dayKey(date))?.size ?? 0);
  const monthConversations = new Set(dayDates.flatMap((date) => [...(daily.conversations.get(dayKey(date)) ?? [])])).size;
  const monthLabel = month.toLocaleDateString(getLocale(), { year: month.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long' });

  // Daily tokens over the last 30 days, against the 30 before them.
  const trendDates = Array.from({ length: 30 }, (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29 + index));
  const trend = trendDates.map((date) => ({ value: daily.tokens.get(dayKey(date)) ?? 0, label: shortDate(date) }));
  const trendTotal = trend.reduce((total, point) => total + point.value, 0);
  const previousTotal = Array.from({ length: 30 }, (_, index) => daily.tokens.get(dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 59 + index))) ?? 0)
    .reduce((total, value) => total + value, 0);
  const change = previousTotal > 0 ? (trendTotal - previousTotal) / previousTotal * 100 : null;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <ScrollArea className="h-full" contentClassName="px-5 pb-6" surface="full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pt-1">
        <AiProfileCard
          avatar={<AppIcon className="size-12" />}
          name="TodeX"
          subtitle={t('usage.profileSummary', { records: filtered.length, models: new Set(filtered.map((record) => record.model)).size })}
          badge={<Badge color="neutral">{provider === 'all' ? t('usage.allAgents') : titleCase(provider)}</Badge>}
          actions={(
            <>
              <Select
                aria-label="Agent"
                size="sm"
                className="w-36"
                triggerClassName="w-full"
                popoverClassName="w-56"
                selectedKey={provider}
                onSelectionChange={(key) => { if (typeof key === 'string') { setProvider(key); setModel('all'); } }}
              >
                <SelectItem id="all" textValue={t('usage.allAgents')}>{t('usage.allAgents')}</SelectItem>
                {providers.map((item) => <SelectItem key={item} id={item} textValue={titleCase(item)}>{titleCase(item)}</SelectItem>)}
              </Select>
              <Select
                aria-label={t('usage.modelLabel')}
                size="sm"
                className="w-36"
                triggerClassName="w-full"
                popoverClassName="w-56"
                selectedKey={models.includes(model) ? model : 'all'}
                onSelectionChange={(key) => { if (typeof key === 'string') setModel(key); }}
              >
                <SelectItem id="all" textValue={t('usage.allModels')}>{t('usage.allModels')}</SelectItem>
                {models.map((item) => <SelectItem key={item} id={item} textValue={item}>{item}</SelectItem>)}
              </Select>
            </>
          )}
          headlineLabel={t('usage.totalLabel')}
          headline={totals.totalTokens}
          formatHeadline={formatTokens}
          chip={cacheRate === null ? undefined : <Chip variant="bold" color="purple">{t('usage.cacheChip', { rate: cacheRate })}</Chip>}
          stats={[
            { value: formatTokens(totals.inputTokens), label: t('usage.inputLabel') },
            { value: formatTokens(totals.outputTokens), label: t('usage.outputLabel') },
            { value: formatTokens(totals.cachedInputTokens), label: t('usage.cacheReadLabel') },
            { value: formatTokens(totals.cacheWriteTokens), label: t('usage.cacheWriteLabel') },
          ]}
          activityLabel={t('usage.activity')}
          cells={cells}
        />

        <div className="grid w-full gap-4 lg:grid-cols-2">
          <AgentsChartCard
            title={t('usage.activeConversations')}
            total={monthConversations}
            days={conversationDays}
            formatValue={(value) => t('usage.conversationCount', { count: value })}
            dayLabel={(index) => shortDate(dayDates[index])}
            periodLabel={monthLabel}
            onPrev={() => setMonthOffset((offset) => offset - 1)}
            onNext={() => setMonthOffset((offset) => Math.min(0, offset + 1))}
            prevLabel={t('usage.previousMonth')}
            nextLabel={t('usage.nextMonth')}
            startLabel={shortDate(dayDates[0])}
            endLabel={monthOffset === 0 ? t('usage.today') : shortDate(dayDates[dayDates.length - 1])}
          />

          <TokensChartCard
            title={t('usage.last30Days')}
            series={trend}
            total={trendTotal}
            change={change === null ? '' : `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}%`}
            formatValue={(value) => t('usage.tokensValue', { value: formatTokens(value) })}
            startLabel={trend[0].label}
            endLabel={t('usage.today')}
          />
        </div>

        <section className="flex w-full flex-col gap-2.5 rounded-[20px] bg-background-secondary-default px-2.5 py-3">
          <div className="flex flex-col gap-0.5 px-1.5 pt-1">
            <p className="text-body-medium text-text-secondary">{provider === 'all' ? t('usage.byAgent') : t('usage.byModel')}</p>
            <p className="text-body-2-regular text-text-tertiary">{t('usage.chartHint')}</p>
          </div>
          {breakdown.length ? (
            <div className="flex flex-col gap-1">
              {breakdown.slice(0, 12).map((row) => {
                const width = breakdownMax ? Math.max((row.total / breakdownMax) * 100, 2) : 0;
                return (
                  <div key={row.name} className="group relative flex h-9 items-center justify-between gap-3 rounded-lg px-2.5">
                    <div
                      aria-hidden
                      className="absolute inset-y-0 start-0 rounded-lg bg-chart-agents-bar/40 transition-[width,background-color] duration-500 ease-out group-hover:bg-chart-agents-bar/70 motion-reduce:transition-none"
                      style={{ width: mounted ? `${width}%` : 0 }}
                    />
                    <span className="relative min-w-0 truncate text-body-regular text-text-primary" title={row.name}>{row.name}</span>
                    <span className="relative shrink-0 text-body-medium text-text-primary tabular-nums">{formatTokens(row.total)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState className="min-h-40" size="sm" icon={RiBarChartBoxLine} title={t('usage.emptyTitle')} description={t('usage.emptyHint')} />
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

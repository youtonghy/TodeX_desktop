import { useMemo, useState } from 'react';
import { RiBarChartBoxLine } from '@remixicon/react';
import { usageTotalTokens } from '@todex/protocol/conversationRuntime';
import { AgentsChartCard } from '@/components/application/ai-profile/agents-chart-card';
import { AiProfileCard } from '@/components/application/ai-profile/ai-profile-card';
import { AreaChartCard, type AreaPoint, type AreaRange } from '@/components/application/charts/area-chart-card';
import { BarListCard, type BarListTab } from '@/components/application/charts/bar-list-card';
import { CHART_TONES } from '@/components/application/charts/chart-card';
import { HeatmapChartCard, type HeatmapRange } from '@/components/application/charts/heatmap-chart-card';
import type { ContributionCell } from '@/components/application/dashboard/contributions-card';
import { ActivityRingsCard } from '@/components/application/medical/activity-rings-card';
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
/** Selectable periods of the composition and hour charts, in days. */
const PERIODS = [7, 30, 90] as const;
/** Two-hour columns of the activity-by-hour heatmap, by starting hour. */
const HOUR_BUCKETS = Array.from({ length: 12 }, (_, index) => index * 2);

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

export function formatTokens(value: number): string {
  return new Intl.NumberFormat(getLocale(), {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function modelName(value: string): string {
  return value === 'unknown' ? t('usage.unknown') : value;
}

function titleCase(value: string): string {
  return value === 'unknown' ? t('usage.unknown') : value.charAt(0).toUpperCase() + value.slice(1);
}

/** Local calendar day key, YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
}

type Composition = { input: number; output: number; cacheRead: number; cacheWrite: number };

const EMPTY_COMPOSITION: Composition = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Daily token totals, their composition and the conversations seen each day.
 * Cache tokens only stack on top of input where the agent reports them
 * separately (`additional`); `included` caches are already part of input. */
function dailyUsage(records: UsageRecord[]) {
  const tokens = new Map<string, number>();
  const composition = new Map<string, Composition>();
  const conversations = new Map<string, Set<string>>();
  for (const record of records) {
    const key = dayKey(new Date(record.updatedAt));
    tokens.set(key, (tokens.get(key) ?? 0) + usageTotalTokens(record));
    const extra = record.cacheSemantics === 'additional';
    const day = composition.get(key) ?? EMPTY_COMPOSITION;
    composition.set(key, {
      input: day.input + record.inputTokens,
      output: day.output + record.outputTokens,
      cacheRead: day.cacheRead + (extra ? record.cachedInputTokens : 0),
      cacheWrite: day.cacheWrite + (extra ? record.cacheWriteTokens : 0),
    });
    let seen = conversations.get(key);
    if (!seen) conversations.set(key, seen = new Set());
    seen.add(record.conversationId);
  }
  return { tokens, composition, conversations };
}

/** The `days` days ending `endOffset` days before today, oldest first. */
function daysBack(today: Date, days: number, endOffset = 0): Date[] {
  return Array.from({ length: days }, (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - endOffset - days + 1 + index));
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

/** Token composition chart periods: daily rows, delta against the period before. */
function compositionRanges(composition: Map<string, Composition>, today: Date): AreaRange[] {
  const totalOf = (dates: Date[]) => dates.reduce((total, date) => {
    const day = composition.get(dayKey(date)) ?? EMPTY_COMPOSITION;
    return total + day.input + day.output + day.cacheRead + day.cacheWrite;
  }, 0);
  return PERIODS.map((days) => {
    const dates = daysBack(today, days);
    const previous = totalOf(daysBack(today, days, days));
    const data: AreaPoint[] = dates.map((date) => ({ label: shortDate(date), ...(composition.get(dayKey(date)) ?? EMPTY_COMPOSITION) }));
    return {
      id: `${days}d`,
      label: t(`usage.last${days}Days`),
      data,
      delta: previous > 0 ? (totalOf(dates) - previous) / previous : undefined,
    };
  });
}

/** Tokens by weekday (Monday first) × two-hour block for each period,
 * with the change against the period before. */
function hourRanges(records: UsageRecord[], today: Date): HeatmapRange[] {
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index).toLocaleDateString(getLocale(), { weekday: 'short' }));
  const columns = HOUR_BUCKETS.map((hour) => t('usage.hourLabel', { hour }));
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  return PERIODS.map((days) => {
    const start = daysBack(today, days)[0].getTime();
    const previousStart = daysBack(today, days, days)[0].getTime();
    const values = weekdays.map(() => HOUR_BUCKETS.map(() => 0));
    let total = 0;
    let previous = 0;
    for (const record of records) {
      const value = usageTotalTokens(record);
      if (record.updatedAt >= previousStart && record.updatedAt < start) previous += value;
      if (record.updatedAt < start || record.updatedAt >= end) continue;
      const date = new Date(record.updatedAt);
      values[(date.getDay() + 6) % 7][Math.floor(date.getHours() / 2)] += value;
      total += value;
    }
    return {
      id: `${days}d`,
      label: t(`usage.last${days}Days`),
      rows: weekdays.map((label, index) => ({ label, values: values[index] })),
      columns,
      delta: previous > 0 ? (total - previous) / previous : undefined,
    };
  });
}

/** Token share by agent and by model; a model takes the colour of the agent
 * that used it most. */
function usageRanking(records: UsageRecord[], toneOf: (provider: string) => (typeof CHART_TONES)[number]): BarListTab[] {
  const agents = new Map<string, number>();
  const models = new Map<string, Map<string, number>>();
  for (const record of records) {
    const value = usageTotalTokens(record);
    if (value <= 0) continue;
    agents.set(record.provider, (agents.get(record.provider) ?? 0) + value);
    const byAgent = models.get(record.model) ?? new Map<string, number>();
    byAgent.set(record.provider, (byAgent.get(record.provider) ?? 0) + value);
    models.set(record.model, byAgent);
  }
  const modelItems = [...models].map(([model, byAgent]) => {
    const ranked = [...byAgent].sort((a, b) => b[1] - a[1]);
    return { label: modelName(model), value: ranked.reduce((total, [, value]) => total + value, 0), color: toneOf(ranked[0][0]).color };
  });
  return [
    { id: 'models', label: t('usage.modelLabel'), items: modelItems.sort((a, b) => b.value - a.value) },
    {
      id: 'agents',
      label: 'Agent',
      items: [...agents].map(([provider, value]) => ({ label: titleCase(provider), value, color: toneOf(provider).color })).sort((a, b) => b.value - a.value),
    },
  ];
}

/** The user's profile page, in place of the conversation: usage on the
 * BoardUI AI profile template and chart cards. The profile card carries the
 * totals and the activity heatmap; below it, 30-day goal rings beside the
 * active conversations per day, the daily token composition, usage by
 * weekday and hour, and the token share ranking of agents and models. */
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
  const leader = useMemo(() => {
    const key = (record: UsageRecord) => provider === 'all' ? record.provider : record.model;
    const values = new Map<string, number>();
    for (const record of filtered) values.set(key(record), (values.get(key(record)) ?? 0) + usageTotalTokens(record));
    const [name, total] = [...values].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    return { name: provider === 'all' ? titleCase(name) : modelName(name), total };
  }, [filtered, provider]);

  // One colour per agent, stable across the filters, shared by every chart.
  const toneOf = useMemo(() => {
    const tones = new Map(providers.map((item, index) => [item, CHART_TONES[index % CHART_TONES.length]]));
    return (item: string) => tones.get(item) ?? CHART_TONES[0];
  }, [providers]);

  const today = useMemo(() => new Date(), []);
  const daily = useMemo(() => dailyUsage(filtered), [filtered]);
  const cells = useMemo(() => heatmapCells(daily.tokens, today), [daily, today]);
  const composition = useMemo(() => compositionRanges(daily.composition, today), [daily, today]);
  const hours = useMemo(() => hourRanges(filtered, today), [filtered, today]);
  const ranking = useMemo(() => usageRanking(filtered, toneOf), [filtered, toneOf]);

  // Active conversations per day for the selected month.
  const month = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const monthDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const dayDates = Array.from({ length: monthDays }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1));
  const conversationDays = dayDates.map((date) => daily.conversations.get(dayKey(date))?.size ?? 0);
  const monthConversations = new Set(dayDates.flatMap((date) => [...(daily.conversations.get(dayKey(date)) ?? [])])).size;
  const monthLabel = month.toLocaleDateString(getLocale(), { year: month.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long' });

  // The goal rings: days with usage of the last 30, the cache hit rate, and
  // the busiest agent's (or model's) share of all tokens.
  const activeDays = daysBack(today, 30).filter((date) => (daily.tokens.get(dayKey(date)) ?? 0) > 0).length;
  const leaderShare = totals.totalTokens ? Math.round((leader.total / totals.totalTokens) * 100) : 0;
  const rings = [
    { label: t('usage.activeDays'), value: t('usage.activeDaysValue', { count: activeDays }), goalPct: Math.round((activeDays / 30) * 100) },
    { label: t('usage.cacheHitRateLabel'), value: cacheRate === null ? t('usage.none') : `${cacheRate}%`, goalPct: cacheRate ?? 0 },
    {
      label: provider === 'all' ? t('usage.topAgent') : t('usage.topModel'),
      value: leader.total ? `${leader.name} · ${leaderShare}%` : t('usage.none'),
      goalPct: leaderShare,
    },
  ];

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
          <ActivityRingsCard title={t('usage.overview')} rings={rings} ariaLabel={t('usage.overviewAria')} />

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
        </div>

        <AreaChartCard
          title={t('usage.composition')}
          series={[
            { key: 'input', label: t('usage.inputLabel'), color: 'var(--color-chart-6)', activeColor: 'var(--color-chart-6-active)' },
            { key: 'output', label: t('usage.outputLabel'), color: 'var(--color-chart-3)', activeColor: 'var(--color-chart-3-active)' },
            { key: 'cacheRead', label: t('usage.cacheReadLabel'), color: 'var(--color-chart-7)', activeColor: 'var(--color-chart-7-active)' },
            { key: 'cacheWrite', label: t('usage.cacheWriteLabel'), color: 'var(--color-chart-8)', activeColor: 'var(--color-chart-8-active)' },
          ]}
          ranges={composition}
          defaultRange="30d"
          format={formatTokens}
          formatTick={formatTokens}
          className="h-[360px]"
        />

        {ranking[0].items.length ? (
          <div className="grid w-full gap-4 lg:grid-cols-2">
            <HeatmapChartCard
              title={t('usage.activeHours')}
              ranges={hours}
              defaultRange="30d"
              format={formatTokens}
              color="var(--color-chart-5)"
              activeColor="var(--color-chart-5-active)"
              scale="sqrt"
              legendLabels={[t('usage.less'), t('usage.more')]}
              className="h-full min-h-[329px]"
            />
            <BarListCard
              tabs={ranking}
              vivid
              metricLabel={t('usage.tokenShare')}
              format={formatTokens}
              limit={6}
            />
          </div>
        ) : (
          <section className="flex w-full flex-col rounded-[20px] bg-background-secondary-default px-2.5 py-3">
            <EmptyState className="min-h-40" size="sm" icon={RiBarChartBoxLine} title={t('usage.emptyTitle')} description={t('usage.emptyHint')} />
          </section>
        )}
      </div>
    </ScrollArea>
  );
}

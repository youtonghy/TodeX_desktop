import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RiChat3Line, RiCheckDoubleLine, RiPulseLine } from '@remixicon/react';
import { awaitedBackgroundTasks, usageTotalTokens } from '@todex/protocol/conversationRuntime';
import { providerDisplayName, type ProviderQuotaSnapshot } from '@todex/protocol/v2';
import { AgentLimitsCard } from '@/components/application/agent-limits/agent-limits-card';
import { AgentsChartCard } from '@/components/application/ai-profile/agents-chart-card';
import { BarListCard, type BarListTab } from '@/components/application/charts/bar-list-card';
import { CHART_TONES } from '@/components/application/charts/chart-card';
import { Badge } from '@/components/base/badges/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cx } from '@/utils/cx';
import { ProviderIcon } from '../components/ProviderIcon';
import { sameRecordValues, useRuntimeSelector, useTimelineSelector } from '../session/conversationStore';
import { backendApi, getConversationStatus, isListedConversation, isPrivateConversation, workspaceDisplayName, type ConversationRecord, type TimelineEntry, type UsageRecord } from '../session/helpers';
import { quotaLimits } from '../session/quota';
import type { TodeXSession } from '../session/useTodeXSession';
import { getLocale, useT } from '../i18n';
import { dayKey, formatTokens } from './ProfilePanel';

type Props = { session: TodeXSession; onOpenConversation: () => void };

/** How often the plan limits are fetched again while the board is open. */
const QUOTA_REFRESH_MS = 60_000;

const SECTION = 'flex min-w-0 flex-col rounded-[20px] bg-background-secondary-default p-4';
const ROW = '-mx-2 flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-start outline-none transition-colors duration-150 hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring';

type LatestInfo = { latest?: TimelineEntry; latestIncomingAt: number };

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}

function StatTile({ label, value, dot }: { label: string; value: ReactNode; dot?: string }) {
  return (
    <div className={cx(SECTION, 'gap-2')}>
      <span className="flex items-center gap-2 text-body-medium text-text-secondary">
        {dot ? <span aria-hidden className={cx('size-2 rounded-full', dot)} /> : null}
        {label}
      </span>
      <span className="text-title-1-medium text-text-primary tabular-nums">{value}</span>
    </div>
  );
}

function SectionTitle({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 pb-1">
      <h2 className="text-body-medium text-text-secondary">{children}</h2>
      {count ? <Badge color="neutral">{count}</Badge> : null}
    </div>
  );
}

/** The home board, in place of the conversation: what is running and what
 * waits on the user right now, today's conversations and token usage, and
 * each agent's plan limits (5-hour and weekly windows). */
export function HomePanel({ session, onOpenConversation }: Props) {
  const t = useT();
  // Re-reads "today" each minute so the board rolls over at midnight.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [dayOffset, setDayOffset] = useState(0);

  // --- Live status -----------------------------------------------------------
  const latestById = useTimelineSelector(session.stores, (timeline) => {
    const map: Record<string, LatestInfo> = {};
    for (const entry of timeline) {
      if (!entry.conversationId) continue;
      const existing = map[entry.conversationId] ??= { latest: undefined, latestIncomingAt: 0 };
      if (!existing.latest || entry.at > existing.latest.at) existing.latest = entry;
      if (entry.kind === 'incoming' && entry.at > existing.latestIncomingAt) existing.latestIncomingAt = entry.at;
    }
    return map;
  }, (left, right) => sameRecordValues(left, right, (a, b) => a.latestIncomingAt === b.latestIncomingAt
    && a.latest?.id === b.latest?.id && a.latest?.at === b.latest?.at && a.latest?.marker === b.latest?.marker && a.latest?.title === b.latest?.title));
  const backgroundWaits = useRuntimeSelector(session.stores, (runtimes) => {
    const map: Record<string, boolean> = {};
    for (const [id, runtime] of Object.entries(runtimes)) if (awaitedBackgroundTasks(runtime.backgroundTasks).length > 0) map[id] = true;
    return map;
  }, sameRecordValues);

  const conversations = useMemo(
    () => session.conversations.filter((conversation) => !conversation.archived && isListedConversation(conversation) && !isPrivateConversation(conversation)),
    [session.conversations],
  );
  const { running, waiting } = useMemo(() => {
    const statusSession = { activeConversationId: session.activeConversationId, turnIds: session.turnIds, backgroundWaits };
    const asking = new Set(session.pendingRequests.map((request) => request.data.conversationId));
    const running: ConversationRecord[] = [];
    const waiting: { conversation: ConversationRecord; reason: string }[] = [];
    for (const conversation of conversations) {
      const info = latestById[conversation.id];
      const status = getConversationStatus(statusSession, conversation, info?.latest, info?.latestIncomingAt);
      // A permission prompt blocks the turn: the agent waits on the user. The
      // backend's own status (`nativeStatus`) covers conversations this client
      // has not opened, whose turn ids and prompts it does not hold.
      if (conversation.nativeStatus === 'waiting_permission' || (conversation.v2ConversationId && asking.has(conversation.v2ConversationId))) waiting.push({ conversation, reason: t('home.waitPermission') });
      else if (status?.kind === 'working' || conversation.nativeStatus === 'running') running.push(conversation);
      else if (status) waiting.push({ conversation, reason: status.label });
    }
    const byRecent = (a: ConversationRecord, b: ConversationRecord) => b.updatedAt - a.updatedAt;
    return { running: running.sort(byRecent), waiting: waiting.sort((a, b) => byRecent(a.conversation, b.conversation)) };
  }, [conversations, latestById, backgroundWaits, session.activeConversationId, session.turnIds, session.pendingRequests, t]);

  // --- Today -----------------------------------------------------------------
  const today = dayKey(new Date(now));
  const todayRecords = useMemo(() => session.usageRecords.filter((record) => dayKey(new Date(record.updatedAt)) === today), [session.usageRecords, today]);
  const todayTokens = todayRecords.reduce((total, record) => total + usageTotalTokens(record), 0);
  const todayRows = useMemo(() => {
    const byConversation = new Map<string, { tokens: number; turns: Set<string>; at: number }>();
    for (const record of todayRecords) {
      const row = byConversation.get(record.conversationId) ?? { tokens: 0, turns: new Set<string>(), at: 0 };
      row.tokens += usageTotalTokens(record);
      row.turns.add(record.turnId ?? record.id);
      row.at = Math.max(row.at, record.updatedAt);
      byConversation.set(record.conversationId, row);
    }
    return conversations
      .filter((conversation) => byConversation.has(conversation.id) || dayKey(new Date(conversation.updatedAt)) === today)
      .map((conversation) => {
        const usage = byConversation.get(conversation.id);
        return { conversation, tokens: usage?.tokens ?? 0, turns: usage?.turns.size ?? 0, at: Math.max(usage?.at ?? 0, conversation.updatedAt) };
      })
      .sort((a, b) => b.at - a.at);
  }, [conversations, todayRecords, today]);

  // --- Statistics: tokens per hour of the picked day, and today's shares ------
  const pickedDate = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + dayOffset);
  const pickedKey = dayKey(pickedDate);
  const hourly = useMemo(() => {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const record of session.usageRecords) {
      const date = new Date(record.updatedAt);
      if (dayKey(date) === pickedKey) hours[date.getHours()] += usageTotalTokens(record);
    }
    return hours;
  }, [session.usageRecords, pickedKey]);
  const shares = useMemo<BarListTab[]>(() => {
    const sumBy = (key: (record: UsageRecord) => string, label: (value: string) => string) => {
      const totals = new Map<string, number>();
      for (const record of todayRecords) totals.set(key(record), (totals.get(key(record)) ?? 0) + usageTotalTokens(record));
      return [...totals].sort((a, b) => b[1] - a[1]).map(([name, value], index) => ({ label: label(name), value, color: CHART_TONES[index % CHART_TONES.length].color }));
    };
    return [
      { id: 'agents', label: 'Agent', items: sumBy((record) => record.provider, (value) => providerDisplayName(value)) },
      { id: 'models', label: t('usage.modelLabel'), items: sumBy((record) => record.model, (value) => (value === 'unknown' ? t('usage.unknown') : value)) },
    ];
  }, [todayRecords, t]);

  // --- Plan limits -----------------------------------------------------------
  // undefined: loading; null: the backend could not be asked.
  const [quotas, setQuotas] = useState<Record<string, ProviderQuotaSnapshot> | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = () => backendApi(session.settings).getProviderQuotas()
      .then((response) => { if (!cancelled) setQuotas(response.providers ?? {}); })
      .catch(() => { if (!cancelled) setQuotas((current) => current ?? null); });
    void load();
    const timer = window.setInterval(load, QUOTA_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session.settings]);
  const plans = Object.values(quotas ?? {}).filter((snapshot) => quotaLimits(snapshot).length > 0);

  const open = (conversation: ConversationRecord) => {
    session.selectConversation(conversation.workspaceId, conversation.id);
    onOpenConversation();
  };
  const workspaceName = (conversation: ConversationRecord) => {
    const workspace = session.workspaces.find((item) => item.id === conversation.workspaceId);
    return workspace ? workspaceDisplayName(workspace) : '';
  };
  const subtitle = (conversation: ConversationRecord) => [workspaceName(conversation), conversation.provider ? providerDisplayName(conversation.provider) : '', conversation.model ?? '']
    .filter(Boolean).join(' · ');
  const conversationRow = (conversation: ConversationRecord, trailing: ReactNode) => (
    <button key={conversation.id} type="button" className={ROW} onClick={() => open(conversation)}>
      <ProviderIcon provider={conversation.provider} className="size-5 shrink-0 text-foreground-icon-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-medium text-text-primary">{conversation.title || conversation.preview || '—'}</span>
        <span className="truncate text-body-2-regular text-text-tertiary">{subtitle(conversation)}</span>
      </span>
      {trailing}
    </button>
  );
  const emptyLine = (text: string) => <p className="py-2 text-body-2-regular text-text-tertiary">{text}</p>;

  return (
    <ScrollArea className="h-full" contentClassName="px-5 pb-6" surface="full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pt-1">
        <div className="grid w-full grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label={t('home.running')} value={running.length} dot={running.length ? 'bg-chart-7 animate-pulse motion-reduce:animate-none' : 'bg-chart-track'} />
          <StatTile label={t('home.waiting')} value={waiting.length} dot={waiting.length ? 'bg-chart-8' : 'bg-chart-track'} />
          <StatTile label={t('home.todayConversations')} value={todayRows.length} />
          <StatTile label={t('home.todayTokens')} value={formatTokens(todayTokens)} />
        </div>

        <div className="grid w-full items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className={SECTION} aria-label={t('home.running')}>
              <SectionTitle count={running.length}>{t('home.running')}</SectionTitle>
              {running.length ? running.map((conversation) => conversationRow(conversation, (
                <span className="flex shrink-0 items-center gap-1.5 text-body-2-regular text-text-secondary">
                  <span aria-hidden className="size-2 rounded-full bg-chart-7 animate-pulse motion-reduce:animate-none" />
                  {t('sidebar.statusWorking')}
                </span>
              ))) : emptyLine(t('home.runningEmpty'))}
            </section>
            <section className={SECTION} aria-label={t('home.waiting')}>
              <SectionTitle count={waiting.length}>{t('home.waiting')}</SectionTitle>
              {waiting.length ? waiting.map(({ conversation, reason }) => conversationRow(conversation, (
                <span className="flex shrink-0 items-center gap-1.5 text-body-2-regular text-text-secondary">
                  <span aria-hidden className="size-2 rounded-full bg-chart-8" />
                  {reason}
                </span>
              ))) : emptyLine(t('home.waitingEmpty'))}
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {plans.length ? plans.map((snapshot) => (
              <AgentLimitsCard
                key={snapshot.provider}
                className="rounded-[20px]"
                title={(
                  <>
                    <ProviderIcon provider={snapshot.provider} className="size-4 shrink-0 text-foreground-icon-secondary" />
                    <span className="min-w-0 truncate text-body-medium text-text-primary">{providerDisplayName(snapshot.provider)}</span>
                  </>
                )}
                plan={snapshot.planType ?? undefined}
                limits={quotaLimits(snapshot)}
                labels={{ limits: t('home.limits') }}
              />
            )) : (
              <section className={SECTION}>
                <SectionTitle>{t('home.limits')}</SectionTitle>
                {emptyLine(quotas === undefined ? t('usage.quotaLoading') : t('home.limitsEmpty'))}
              </section>
            )}
          </div>
        </div>

        <section className={SECTION} aria-label={t('home.todayList')}>
          <SectionTitle count={todayRows.length}>{t('home.todayList')}</SectionTitle>
          {todayRows.length ? todayRows.map(({ conversation, tokens, turns, at }) => conversationRow(conversation, (
            <span className="flex shrink-0 items-center gap-4 text-body-2-regular text-text-secondary tabular-nums">
              {turns ? <span className="flex items-center gap-1"><RiChat3Line aria-hidden className="size-3.5 text-foreground-icon-tertiary" />{t('home.turns', { count: turns })}</span> : null}
              {tokens ? <span className="flex items-center gap-1"><RiPulseLine aria-hidden className="size-3.5 text-foreground-icon-tertiary" />{formatTokens(tokens)}</span> : null}
              <span className="w-12 text-end text-text-tertiary">{clock(at)}</span>
            </span>
          ))) : <EmptyState className="min-h-32" size="sm" icon={RiCheckDoubleLine} title={t('home.todayEmpty')} />}
        </section>

        <div className="grid w-full gap-4 lg:grid-cols-2">
          <AgentsChartCard
            title={t('home.hourly')}
            total={hourly.reduce((total, value) => total + value, 0)}
            days={hourly}
            formatValue={formatTokens}
            dayLabel={(index) => `${String(index).padStart(2, '0')}:00`}
            periodLabel={dayOffset === 0 ? t('usage.today') : pickedDate.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' })}
            onPrev={() => setDayOffset((offset) => offset - 1)}
            onNext={() => setDayOffset((offset) => Math.min(0, offset + 1))}
            prevLabel={t('home.previousDay')}
            nextLabel={t('home.nextDay')}
            startLabel="00:00"
            endLabel="23:00"
          />
          {shares[0].items.length ? (
            <BarListCard tabs={shares} vivid metricLabel={t('usage.tokenShare')} format={formatTokens} limit={6} />
          ) : (
            <section className={SECTION}>
              <EmptyState className="min-h-40" size="sm" icon={RiPulseLine} title={t('usage.emptyTitle')} />
            </section>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

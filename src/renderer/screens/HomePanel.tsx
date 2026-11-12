import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RiArrowGoBackLine, RiChat3Line, RiCheckDoubleLine, RiCloseLine, RiCoinsLine, RiDraggable, RiExpandDiagonal2Line, RiLayoutGridLine, RiPlayCircleLine, RiPulseLine, RiQuestionAnswerLine } from '@remixicon/react';
import { awaitedBackgroundTasks, usageTotalTokens } from '@todex/protocol/conversationRuntime';
import { providerDisplayName, type ProviderQuotaSnapshot } from '@todex/protocol/v2';
import { AgentLimitsCard } from '@/components/application/agent-limits/agent-limits-card';
import { AgentsChartCard } from '@/components/application/ai-profile/agents-chart-card';
import { BarListCard, type BarListTab } from '@/components/application/charts/bar-list-card';
import { CHART_TONES } from '@/components/application/charts/chart-card';
import { Badge } from '@/components/base/badges/badge';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cx } from '@/utils/cx';
import { ProviderIcon } from '../components/ProviderIcon';
import { sameRecordValues, useRuntimeSelector, useTimelineSelector } from '../session/conversationStore';
import { backendApi, getConversationStatus, isListedConversation, isPrivateConversation, workspaceDisplayName, type ConversationRecord, type TimelineEntry, type UsageRecord } from '../session/helpers';
import { HOME_COLUMNS, HOME_MIN_HEIGHT, isHomeWidgetId, resetHomeLayout, setHomeLayout, useHomeLayout, type HomeWidgetId, type HomeWidgetLayout } from '../session/homeLayout';
import { quotaLimits } from '../session/quota';
import type { TodeXSession } from '../session/useTodeXSession';
import { getLocale, useT } from '../i18n';
import { dayKey, formatTokens } from './ProfilePanel';

type Props = { session: TodeXSession; onOpenConversation: () => void };

/** How often the plan limits are fetched again while the board is open. */
const QUOTA_REFRESH_MS = 60_000;

const SECTION = 'flex min-w-0 flex-col rounded-[20px] bg-background-secondary-default p-4';
/** Gap between the cards of the grid, in pixels (`gap-4`). */
const GRID_GAP = 16;
const ROW = 'flex min-w-0 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-start outline-none transition-colors duration-150 hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring';

type LatestInfo = { latest?: TimelineEntry; latestIncomingAt: number };

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}

type TileIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/** A headline number under its label; `tone` tints the icon chip (a live
 * count that is not zero), otherwise it stays neutral. */
function StatTile({ label, value, icon: Icon, tone }: { label: string; value: ReactNode; icon: TileIcon; tone?: string }) {
  return (
    <div className={cx(SECTION, 'h-full gap-2')}>
      <span className="flex items-center gap-2 text-body-medium text-text-secondary">
        <span aria-hidden className={cx('flex size-7 shrink-0 items-center justify-center rounded-lg', tone ?? 'bg-background-tertiary-default text-foreground-icon-secondary')}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 truncate">{label}</span>
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

/** A titled list card; with a fixed height its rows scroll under the title. */
function ListSection({ title, count, fixed, children }: { title: string; count?: number; fixed: boolean; children: ReactNode }) {
  return (
    <section className={cx(SECTION, 'h-full')} aria-label={title}>
      <SectionTitle count={count}>{title}</SectionTitle>
      {fixed
        ? <ScrollArea className="-mx-2 min-h-0 flex-1" contentClassName="flex flex-col" surface="secondary">{children}</ScrollArea>
        : <div className="-mx-2 flex flex-col">{children}</div>}
    </section>
  );
}

const HANDLE = 'absolute z-10 flex size-7 items-center justify-center rounded-lg border border-border-button-default bg-background-primary-default text-foreground-icon-secondary shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring';

/** One card of the home grid. While the layout is edited it shows a move
 * handle (drag to reorder), a remove button and a resize handle (drag for width in columns
 * and height in pixels; double-click for the content's own height), and its
 * content is inert. */
function HomeWidget({ item, name, editing, columns, columnWidth, onResize, onRemove, children }: {
  item: HomeWidgetLayout;
  name: string;
  editing: boolean;
  columns: number;
  columnWidth: number;
  onResize: (patch: Partial<Pick<HomeWidgetLayout, 'span' | 'height'>>) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !editing });
  const elementRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; y: number; width: number; height: number; span: number; rtl: boolean } | null>(null);
  const span = Math.min(item.span, columns);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const element = elementRef.current;
    if (!element) return;
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = element.getBoundingClientRect();
    dragStart.current = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, span, rtl: getComputedStyle(element).direction === 'rtl' };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const dx = (event.clientX - start.x) * (start.rtl ? -1 : 1);
    const dy = event.clientY - start.y;
    const nextSpan = Math.min(columns, Math.max(1, Math.round((start.width + dx + GRID_GAP) / (columnWidth + GRID_GAP))));
    const patch: Partial<Pick<HomeWidgetLayout, 'span' | 'height'>> = {};
    // The span only changes once the pointer crosses into another column, so
    // a narrow window's clamped span never overwrites the saved one.
    if (nextSpan !== span) patch.span = nextSpan;
    if (Math.abs(dy) > 6) patch.height = Math.max(HOME_MIN_HEIGHT, Math.round((start.height + dy) / 8) * 8);
    if (patch.span !== undefined || (patch.height !== undefined && patch.height !== item.height)) onResize(patch);
  };
  const onPointerUp = () => { dragStart.current = null; };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const height = item.height ?? Math.round(elementRef.current?.getBoundingClientRect().height ?? HOME_MIN_HEIGHT);
    if (event.key === 'ArrowRight') onResize({ span: Math.min(columns, span + 1) });
    else if (event.key === 'ArrowLeft') onResize({ span: Math.max(1, span - 1) });
    else if (event.key === 'ArrowDown') onResize({ height: height + 24 });
    else if (event.key === 'ArrowUp') onResize({ height: Math.max(HOME_MIN_HEIGHT, height - 24) });
    else if (event.key === 'Backspace' || event.key === 'Delete') onResize({ height: null });
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={(node) => { elementRef.current = node; setNodeRef(node); }}
      className={cx('relative flex min-w-0 flex-col rounded-[20px]', editing && 'outline-1 outline-offset-2 outline-border-button-hover outline-dashed', isDragging && 'z-20 opacity-80')}
      style={{ gridColumn: `span ${span}`, height: item.height ?? undefined, transform: CSS.Translate.toString(transform), transition }}
    >
      <div inert={editing} className="flex min-h-0 min-w-0 flex-1 flex-col *:min-h-0 *:flex-1">{children}</div>
      {editing ? (
        <>
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={t('home.move', { name })}
            className={cx(HANDLE, 'end-2 top-2 cursor-grab touch-none active:cursor-grabbing')}
            {...attributes}
            {...listeners}
          >
            <RiDraggable aria-hidden className="size-4" />
          </button>
          <button type="button" aria-label={t('home.remove', { name })} className={cx(HANDLE, 'end-11 top-2 cursor-pointer')} onClick={onRemove}>
            <RiCloseLine aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t('home.resize', { name })}
            className={cx(HANDLE, 'end-2 bottom-2 cursor-nwse-resize touch-none select-none rtl:cursor-nesw-resize')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => onResize({ height: null })}
            onKeyDown={onKeyDown}
          >
            <RiExpandDiagonal2Line aria-hidden className="size-4 rtl:-scale-x-100" />
          </button>
        </>
      ) : null}
    </div>
  );
}

/** The home page, in place of the conversation: what is running and what
 * waits on the user right now, today's conversations and token usage, and
 * each agent's plan limits (5-hour and weekly windows). Its cards can be
 * reordered, resized, removed and added back; the layout is kept per device. */
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
  const emptyLine = (text: string) => <p className="px-2 py-2 text-body-2-regular text-text-tertiary">{text}</p>;
  const statusTag = (dot: string, label: string) => (
    <span className="flex shrink-0 items-center gap-1.5 text-body-2-regular text-text-secondary">
      <span aria-hidden className={cx('size-2 rounded-full', dot)} />
      {label}
    </span>
  );

  // --- Layout ----------------------------------------------------------------
  const layout = useHomeLayout();
  const [editing, setEditing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The grid folds to two columns, then one, as the page narrows.
  const columns = gridWidth >= 880 || gridWidth === 0 ? HOME_COLUMNS : gridWidth >= 520 ? 2 : 1;
  const columnWidth = (gridWidth - GRID_GAP * (columns - 1)) / columns;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = layout.findIndex((item) => item.id === active.id);
    const to = layout.findIndex((item) => item.id === over.id);
    if (from >= 0 && to >= 0) setHomeLayout(arrayMove(layout, from, to));
  };
  const patchWidget = (id: HomeWidgetId, patch: Partial<Omit<HomeWidgetLayout, 'id'>>) => {
    setHomeLayout(layout.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const shown = layout.filter((item) => !item.hidden);
  const removed = layout.filter((item) => item.hidden);
  /** A removed card comes back at the end of the page. */
  const addWidget = (id: HomeWidgetId) => {
    const item = layout.find((entry) => entry.id === id);
    if (item) setHomeLayout([...layout.filter((entry) => entry.id !== id), { ...item, hidden: false }]);
  };

  /** A card's name (for its handles) and content; `fixed` cards have a set
   * height, so their lists scroll inside it. */
  const widgets: Record<HomeWidgetId, { name: string; render: (fixed: boolean) => ReactNode }> = {
    'running-count': {
      name: t('home.countCard', { name: t('home.running') }),
      render: () => <StatTile label={t('home.running')} value={running.length} icon={RiPlayCircleLine} tone={running.length ? 'bg-chart-7/15 text-chart-7' : undefined} />,
    },
    'waiting-count': {
      name: t('home.countCard', { name: t('home.waiting') }),
      render: () => <StatTile label={t('home.waiting')} value={waiting.length} icon={RiQuestionAnswerLine} tone={waiting.length ? 'bg-chart-8/15 text-chart-8' : undefined} />,
    },
    'today-count': { name: t('home.todayConversations'), render: () => <StatTile label={t('home.todayConversations')} value={todayRows.length} icon={RiChat3Line} /> },
    'today-tokens': { name: t('home.todayTokens'), render: () => <StatTile label={t('home.todayTokens')} value={formatTokens(todayTokens)} icon={RiCoinsLine} /> },
    running: {
      name: t('home.running'),
      render: (fixed) => (
        <ListSection title={t('home.running')} count={running.length} fixed={fixed}>
          {running.length ? running.map((conversation) => conversationRow(conversation, statusTag('bg-chart-7 animate-pulse motion-reduce:animate-none', t('sidebar.statusWorking')))) : emptyLine(t('home.runningEmpty'))}
        </ListSection>
      ),
    },
    waiting: {
      name: t('home.waiting'),
      render: (fixed) => (
        <ListSection title={t('home.waiting')} count={waiting.length} fixed={fixed}>
          {waiting.length ? waiting.map(({ conversation, reason }) => conversationRow(conversation, statusTag('bg-chart-8', reason))) : emptyLine(t('home.waitingEmpty'))}
        </ListSection>
      ),
    },
    limits: {
      name: t('home.limits'),
      render: (fixed) => {
        if (!plans.length) {
          return (
            <ListSection title={t('home.limits')} fixed={fixed}>
              {emptyLine(quotas === undefined ? t('usage.quotaLoading') : t('home.limitsEmpty'))}
            </ListSection>
          );
        }
        const cards = (
          <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] content-start gap-4">
            {plans.map((snapshot) => (
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
            ))}
          </div>
        );
        return fixed ? <ScrollArea className="h-full" surface="full">{cards}</ScrollArea> : cards;
      },
    },
    today: {
      name: t('home.todayList'),
      render: (fixed) => (
        <ListSection title={t('home.todayList')} count={todayRows.length} fixed={fixed}>
          {todayRows.length ? todayRows.map(({ conversation, tokens, turns, at }) => conversationRow(conversation, (
            <span className="flex shrink-0 items-center gap-4 text-body-2-regular text-text-secondary tabular-nums">
              {turns ? <span className="flex items-center gap-1"><RiChat3Line aria-hidden className="size-3.5 text-foreground-icon-tertiary" />{t('home.turns', { count: turns })}</span> : null}
              {tokens ? <span className="flex items-center gap-1"><RiPulseLine aria-hidden className="size-3.5 text-foreground-icon-tertiary" />{formatTokens(tokens)}</span> : null}
              <span className="w-12 text-end text-text-tertiary">{clock(at)}</span>
            </span>
          ))) : <EmptyState className="min-h-32" size="sm" icon={RiCheckDoubleLine} title={t('home.todayEmpty')} />}
        </ListSection>
      ),
    },
    hourly: {
      name: t('home.hourly'),
      render: () => (
        <AgentsChartCard
          className="h-full"
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
      ),
    },
    shares: {
      name: t('usage.tokenShare'),
      render: () => (shares[0].items.length ? (
        <BarListCard className="h-full" tabs={shares} vivid metricLabel={t('usage.tokenShare')} format={formatTokens} limit={6} />
      ) : (
        <section className={cx(SECTION, 'h-full')}>
          <EmptyState className="min-h-40" size="sm" icon={RiPulseLine} title={t('usage.emptyTitle')} />
        </section>
      )),
    },
  };

  return (
    <ScrollArea className="h-full" contentClassName="px-5 pb-6" surface="full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 pt-1">
        <div className="flex min-h-8 items-center justify-end gap-2">
          {editing ? (
            <>
              <p className="min-w-0 flex-1 truncate text-body-2-regular text-text-tertiary">{t('home.editHint')}</p>
              {/* Removed cards; picking one puts it back at the end of the page. */}
              <Select
                aria-label={t('home.addCards')}
                placeholder={t('home.addCards')}
                size="sm"
                className="w-40 shrink-0"
                triggerClassName="w-full"
                popoverClassName="w-56"
                selectedKey={null}
                isDisabled={!removed.length}
                onSelectionChange={(key) => { if (isHomeWidgetId(key)) addWidget(key); }}
              >
                {removed.map((item) => <SelectItem key={item.id} id={item.id} textValue={widgets[item.id].name}>{widgets[item.id].name}</SelectItem>)}
              </Select>
              <Button variant="secondary" size="small" leadingIcon={RiArrowGoBackLine} onClick={resetHomeLayout}>{t('home.reset')}</Button>
              <Button variant="primary" size="small" onClick={() => setEditing(false)}>{t('ssh.done')}</Button>
            </>
          ) : (
            <Button variant="ghost" size="small" leadingIcon={RiLayoutGridLine} onClick={() => setEditing(true)}>{t('home.customize')}</Button>
          )}
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={shown.map((item) => item.id)} strategy={rectSortingStrategy}>
            <div ref={gridRef} className="grid w-full gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {shown.map((item) => (
                <HomeWidget
                  key={item.id}
                  item={item}
                  name={widgets[item.id].name}
                  editing={editing}
                  columns={columns}
                  columnWidth={columnWidth}
                  onResize={(patch) => patchWidget(item.id, patch)}
                  onRemove={() => patchWidget(item.id, { hidden: true })}
                >
                  {widgets[item.id].render(item.height !== null)}
                </HomeWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {!shown.length && !editing ? (
          <EmptyState className="min-h-60" icon={RiLayoutGridLine} title={t('home.emptyTitle')} description={t('home.emptyHint')} />
        ) : null}
      </div>
    </ScrollArea>
  );
}

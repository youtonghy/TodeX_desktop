import { useMemo, useState, type ReactNode } from 'react';
import { RiChat3Line, RiDeleteBin6Line, RiEyeLine, RiRefreshLine, RiSearchLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmDialog } from '@/components/ui/modal';
import { Meter } from '@/components/ui/progress-bar';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import type { HistoryCleanupPolicy, HistoryCleanupPolicyResponse, HistoryCleanupResult } from '@todex/protocol/v2';
import { ProviderIcon } from '../ProviderIcon';
import { getLocale, t, useT } from '../../i18n';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const AGE_OPTIONS = [7, 14, 30, 90, 180, 365];
const CAPACITY_OPTIONS = [100 * MIB, 500 * MIB, GIB, 2 * GIB, 5 * GIB, 10 * GIB];
const OFF = 'off';

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function pathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Saved values from another client may sit between the presets. */
export function withCurrent(options: number[], current: number | null): number[] {
  return current == null || options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

/** Toasts for a cleanup: what was removed, and how much was skipped. */
export function reportCleanupResult(result: HistoryCleanupResult, labels: { cleaned: 'cleanup.cleaned' | 'cleanup.sessionsCleaned'; skipped: 'cleanup.skipped' | 'cleanup.sessionsSkipped' }) {
  if (result.deleted.length > 0) {
    toast.success(t(labels.cleaned, { count: result.deleted.length, size: formatStorageBytes(result.freedBytes) }));
  } else if (result.skipped.length === 0) {
    toast.success(t('cleanup.nothingToClean'));
  }
  if (result.skipped.length > 0) {
    toast.warning(t(labels.skipped, { count: result.skipped.length }));
  }
}

/** Count, disk usage and (with a size limit) how full it is. */
export function StorageSummaryCard({ title, description, count, countLabel, totalBytes, measuredAt, capacity, loading, onRefresh, children }: {
  title: ReactNode;
  description: ReactNode;
  count: number;
  countLabel: string;
  totalBytes: number;
  measuredAt: string;
  capacity?: number | null;
  loading: boolean;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Card>
      <div className="flex items-start gap-3">
        <CardHeader className="flex-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <IconAction icon={RiRefreshLine} size="md" aria-label={t('cleanup.refreshAria')} disabled={loading} onClick={onRefresh} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card variant="secondary" className="gap-1">
          <span className="text-caption-1-regular text-text-secondary">{countLabel}</span>
          <span className="text-title-2-medium text-text-primary tabular-nums">{count}</span>
        </Card>
        <Card variant="secondary" className="gap-1">
          <span className="text-caption-1-regular text-text-secondary">{t('cleanup.storage')}</span>
          <span className="text-title-2-medium text-text-primary tabular-nums">{formatStorageBytes(totalBytes)}</span>
        </Card>
      </div>
      {capacity ? (
        <Meter
          label={t('cleanup.capacityLabel')}
          valueLabel={`${formatStorageBytes(totalBytes)} / ${formatStorageBytes(capacity)}`}
          value={Math.min(totalBytes, capacity)}
          maxValue={capacity}
          tone={totalBytes >= capacity * 0.9 ? 'warning' : 'accent'}
        />
      ) : null}
      {children}
      {measuredAt ? <p className="text-caption-1-regular text-text-tertiary">{t('cleanup.measuredAt', { time: formatDateTime(measuredAt) })}</p> : null}
    </Card>
  );
}

/** The daemon's automatic cleanup: enable switch, age and size rules, last
 * and next run, and a confirmed run-now action. */
export function CleanupPolicyCard({ hint, state, sizes = true, onSave, onRun, children }: {
  hint: ReactNode;
  /** Without known sizes there is no capacity rule. */
  sizes?: boolean;
  state: HistoryCleanupPolicyResponse | undefined;
  onSave: (policy: HistoryCleanupPolicy) => Promise<void>;
  onRun: () => Promise<void>;
  children?: ReactNode;
}) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  const policy = state?.policy;
  const hasThreshold = policy ? policy.maxAgeDays != null || policy.maxTotalBytes != null : false;
  const lastRun = state?.lastRun;

  const save = async (patch: Partial<HistoryCleanupPolicy>) => {
    if (!policy) return;
    const next = { ...policy, ...patch };
    // A policy without thresholds cannot stay enabled.
    if (next.maxAgeDays == null && next.maxTotalBytes == null) next.enabled = false;
    setSaving(true);
    try {
      await onSave(next);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cleanup.policySaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    setRunning(true);
    try {
      await onRun();
      setConfirming(false);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cleanup.cleanFailed'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3">
        <CardHeader className="flex-1">
          <CardTitle>{t('cleanup.autoTitle')}</CardTitle>
          <CardDescription>{hint}</CardDescription>
        </CardHeader>
        <Switch
          aria-label={t('cleanup.autoTitle')}
          isSelected={policy?.enabled ?? false}
          isDisabled={!policy || saving || !hasThreshold}
          onChange={(enabled) => void save({ enabled })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label={t('cleanup.ageRule')}
          hint={t('cleanup.ageHint')}
          className="w-full"
          popoverClassName="w-(--trigger-width)"
          isDisabled={!policy || saving}
          selectedKey={policy?.maxAgeDays != null ? String(policy.maxAgeDays) : OFF}
          onSelectionChange={(key) => void save({ maxAgeDays: key === OFF || key == null ? null : Number(key) })}
        >
          <SelectItem id={OFF} textValue={t('cleanup.off')}>{t('cleanup.off')}</SelectItem>
          {withCurrent(AGE_OPTIONS, policy?.maxAgeDays ?? null).map((days) => (
            <SelectItem key={days} id={String(days)} textValue={t('cleanup.days', { count: days })}>{t('cleanup.days', { count: days })}</SelectItem>
          ))}
        </Select>
        {sizes ? <Select
          label={t('cleanup.capacityRule')}
          hint={t('cleanup.capacityHint')}
          className="w-full"
          popoverClassName="w-(--trigger-width)"
          isDisabled={!policy || saving}
          selectedKey={policy?.maxTotalBytes != null ? String(policy.maxTotalBytes) : OFF}
          onSelectionChange={(key) => void save({ maxTotalBytes: key === OFF || key == null ? null : Number(key) })}
        >
          <SelectItem id={OFF} textValue={t('cleanup.off')}>{t('cleanup.off')}</SelectItem>
          {withCurrent(CAPACITY_OPTIONS, policy?.maxTotalBytes ?? null).map((bytes) => (
            <SelectItem key={bytes} id={String(bytes)} textValue={formatStorageBytes(bytes)}>{formatStorageBytes(bytes)}</SelectItem>
          ))}
        </Select> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-caption-1-regular text-text-tertiary">
          <span>
            {lastRun
              ? lastRun.error
                ? t('cleanup.lastRunFailed', { time: formatDateTime(lastRun.at), error: lastRun.error })
                : t('cleanup.lastRun', { time: formatDateTime(lastRun.at), count: lastRun.deleted, size: formatStorageBytes(lastRun.freedBytes) })
              : t('cleanup.neverRun')}
          </span>
          {policy?.enabled && state?.nextRunAt ? <span>{t('cleanup.nextRun', { time: formatDateTime(state.nextRunAt) })}</span> : null}
        </div>
        <Button variant="secondary" size="small" disabled={!hasThreshold || running} onClick={() => setConfirming(true)}>
          {t('cleanup.runNow')}
        </Button>
      </div>
      {children}
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={(open) => { if (!open) setConfirming(false); }}
        title={t('cleanup.confirmPolicyTitle')}
        description={t('cleanup.confirmPolicyBody')}
        confirmLabel={t('cleanup.runNow')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={running}
        onConfirm={() => void run()}
      />
    </Card>
  );
}

export type HistoryListItem = {
  id: string;
  provider: string;
  title: string;
  subtitle: string;
  subtitleTitle?: string;
  searchText: string;
  updatedAt: string;
  /** Null when the agent does not report per-session sizes. */
  bytes: number | null;
  /** Cannot be selected (running, or in use by a TodeX conversation). */
  locked: boolean;
  badge?: ReactNode;
  onView?: () => void;
};

type SortKey = 'oldest' | 'newest' | 'largest';

/** Searchable, sortable list with (select-all) selection and a confirmed
 * "clean selected" action. Locked rows cannot be selected. */
export function SelectableHistoryList({ items, loading, sizes = true, emptyLabel, confirmTitle, confirmBody, onClean }: {
  items: HistoryListItem[];
  loading: boolean;
  /** Rows carry sizes: offer the size sort and show totals. */
  sizes?: boolean;
  emptyLabel: string;
  confirmTitle: (count: number) => string;
  confirmBody: (size: string | null) => string;
  onClean: (ids: string[]) => Promise<void>;
}) {
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('oldest');
  const [confirming, setConfirming] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle ? items.filter((item) => item.searchText.toLowerCase().includes(needle)) : items;
    const time = (item: HistoryListItem) => Date.parse(item.updatedAt) || 0;
    return [...filtered].sort((a, b) => (
      sort === 'largest' && sizes ? (b.bytes ?? 0) - (a.bytes ?? 0) : sort === 'newest' ? time(b) - time(a) : time(a) - time(b)
    ));
  }, [items, query, sizes, sort]);

  // Rows that went away or became locked drop out of the selection.
  const chosen = items.filter((item) => selected.has(item.id) && !item.locked);
  const chosenBytes = chosen.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const selectable = visible.filter((item) => !item.locked);
  const selectedVisible = selectable.filter((item) => selected.has(item.id));
  const allSelected = selectable.length > 0 && selectedVisible.length === selectable.length;

  const toggle = (ids: string[], on: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const clean = async () => {
    setCleaning(true);
    try {
      await onClean(chosen.map((item) => item.id));
      setConfirming(false);
      setSelected(new Set());
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cleanup.cleanFailed'));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('cleanup.search')}
          placeholder={t('cleanup.search')}
          leadingIcon={RiSearchLine}
          size="small"
          className="min-w-40 flex-1"
          value={query}
          onChange={setQuery}
        />
        <Select
          aria-label={t('cleanup.sort')}
          size="sm"
          className="w-36"
          popoverClassName="w-(--trigger-width)"
          selectedKey={sort}
          onSelectionChange={(key) => setSort(key === 'newest' || key === 'largest' ? key : 'oldest')}
        >
          <SelectItem id="oldest" textValue={t('cleanup.sortOldest')}>{t('cleanup.sortOldest')}</SelectItem>
          <SelectItem id="newest" textValue={t('cleanup.sortNewest')}>{t('cleanup.sortNewest')}</SelectItem>
          {sizes ? <SelectItem id="largest" textValue={t('cleanup.sortLargest')}>{t('cleanup.sortLargest')}</SelectItem> : null}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-separator-border pb-3">
        <Checkbox
          isSelected={allSelected}
          isIndeterminate={selectedVisible.length > 0 && !allSelected}
          isDisabled={selectable.length === 0}
          onChange={(on) => toggle(selectable.map((item) => item.id), on)}
        >
          {t('cleanup.selectAll')}
        </Checkbox>
        <span className="flex-1 text-caption-1-regular text-text-secondary tabular-nums">
          {chosen.length > 0 ? (sizes ? t('cleanup.selectedSummary', { count: chosen.length, size: formatStorageBytes(chosenBytes) }) : t('cleanup.selectedCount', { count: chosen.length })) : null}
        </span>
        <Button variant="danger" size="small" leadingIcon={RiDeleteBin6Line} disabled={chosen.length === 0 || cleaning} onClick={() => setConfirming(true)}>
          {t('cleanup.cleanSelected')}
        </Button>
      </div>
      {loading && items.length === 0 ? (
        <div className="flex justify-center py-8"><SpinnerIcon className="size-5 text-foreground-icon-tertiary" /></div>
      ) : visible.length === 0 ? (
        <EmptyState size="sm" icon={RiChat3Line} title={query ? t('cleanup.noMatches') : emptyLabel} />
      ) : (
        <ul className="flex flex-col">
          {visible.map((item) => (
            <li key={item.id} className={cx('flex items-center gap-1 rounded-xl pe-1', !item.locked && 'hover:bg-background-secondary-hover')}>
              <Checkbox
                isSelected={selected.has(item.id) && !item.locked}
                isDisabled={item.locked}
                onChange={(on) => toggle([item.id], on)}
                aria-label={item.title}
                className="min-w-0 flex-1 px-2 py-2 *:last:flex *:last:min-w-0 *:last:flex-1"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <ProviderIcon provider={item.provider} className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-medium text-text-primary">{item.title}</span>
                    <span className="truncate text-caption-1-regular text-text-tertiary" title={item.subtitleTitle}>{item.subtitle}</span>
                  </span>
                  {item.badge}
                  <span className="shrink-0 text-body-2-regular text-text-secondary tabular-nums">{item.bytes == null ? '—' : formatStorageBytes(item.bytes)}</span>
                </span>
              </Checkbox>
              {item.onView ? <IconAction icon={RiEyeLine} size="sm" tooltip={t('cleanup.view')} aria-label={t('cleanup.view')} onClick={item.onView} /> : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={(open) => { if (!open) setConfirming(false); }}
        title={confirmTitle(chosen.length)}
        description={confirmBody(sizes ? formatStorageBytes(chosenBytes) : null)}
        confirmLabel={t('cleanup.cleanSelected')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={cleaning}
        onConfirm={() => void clean()}
      />
    </Card>
  );
}

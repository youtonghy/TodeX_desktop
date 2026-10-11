import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RiChat3Line, RiDeleteBin6Line, RiRefreshLine, RiSearchLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
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
import type {
  ConversationStorageEntry,
  HistoryCleanupPolicy,
  HistoryCleanupPolicyResponse,
  HistoryCleanupResult,
} from '@todex/protocol/v2';
import { ProviderIcon } from '../components/ProviderIcon';
import { getLocale, useT } from '../i18n';
import { backendApi } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const AGE_OPTIONS = [7, 14, 30, 90, 180, 365];
const CAPACITY_OPTIONS = [100 * MIB, 500 * MIB, GIB, 2 * GIB, 5 * GIB, 10 * GIB];
const OFF = 'off';
const ACTIVE_STATUSES = new Set(['running', 'waiting_permission']);

type SortKey = 'oldest' | 'newest' | 'largest';

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

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Saved values from another client may sit between the presets. */
function withCurrent(options: number[], current: number | null): number[] {
  return current == null || options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

/** Cleanup: TodeX's own conversation history on the active backend — what
 * it takes on disk, manual (multi-)selection cleanup, and the backend's
 * automatic cleanup policy (by age and/or total size). */
export function CleanupPanel({ session }: { session: TodeXSession }) {
  const t = useT();
  const [entries, setEntries] = useState<ConversationStorageEntry[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [measuredAt, setMeasuredAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [policyState, setPolicyState] = useState<HistoryCleanupPolicyResponse>();
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('oldest');
  const [confirm, setConfirm] = useState<'selected' | 'policy' | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const generation = useRef(0);
  const { getHistoryStorage, purgeConversations, forgetDeletedConversations } = session;
  const api = useCallback(() => backendApi(session.settings), [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.transportVerified, session.settings.serverUrl]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const [storage, policy] = await Promise.all([getHistoryStorage(), api().getHistoryCleanupPolicy()]);
      if (current !== generation.current) return;
      setEntries(storage.conversations);
      setTotalBytes(storage.totalBytes);
      setMeasuredAt(storage.measuredAt);
      setPolicyState(policy);
      const ids = new Set(storage.conversations.map((entry) => entry.id));
      setSelected((previous) => new Set([...previous].filter((id) => ids.has(id))));
    } catch (error) {
      if (current === generation.current) toast.danger(error instanceof Error ? error.message : t('cleanup.readFailed'));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [api, getHistoryStorage]);

  useEffect(() => {
    setEntries([]);
    setSelected(new Set());
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const isActive = (entry: ConversationStorageEntry) => ACTIVE_STATUSES.has(entry.status);
  const titleOf = (entry: ConversationStorageEntry) => entry.title?.trim() || t('cleanup.untitled');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? entries.filter((entry) => `${entry.title ?? ''} ${entry.workspace}`.toLowerCase().includes(needle))
      : entries;
    const time = (entry: ConversationStorageEntry) => Date.parse(entry.updatedAt) || 0;
    return [...filtered].sort((a, b) => (
      sort === 'largest' ? b.bytes - a.bytes : sort === 'newest' ? time(b) - time(a) : time(a) - time(b)
    ));
  }, [entries, query, sort]);

  const selectable = visible.filter((entry) => !isActive(entry));
  const selectedVisible = selectable.filter((entry) => selected.has(entry.id));
  const allSelected = selectable.length > 0 && selectedVisible.length === selectable.length;
  const selectedEntries = entries.filter((entry) => selected.has(entry.id));
  const selectedBytes = selectedEntries.reduce((sum, entry) => sum + entry.bytes, 0);

  const toggleAll = (on: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const entry of selectable) {
        if (on) next.add(entry.id);
        else next.delete(entry.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string, on: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const reportResult = (result: HistoryCleanupResult) => {
    if (result.deleted.length > 0) {
      toast.success(t('cleanup.cleaned', { count: result.deleted.length, size: formatStorageBytes(result.freedBytes) }));
    } else if (result.skipped.length === 0) {
      toast.success(t('cleanup.nothingToClean'));
    }
    if (result.skipped.length > 0) {
      toast.warning(t('cleanup.skipped', { count: result.skipped.length }));
    }
  };

  const cleanSelected = async () => {
    setCleaning(true);
    try {
      const result = await purgeConversations(selectedEntries.map((entry) => entry.id));
      reportResult(result);
      setConfirm(null);
      setSelected(new Set());
      await refresh();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cleanup.cleanFailed'));
    } finally {
      setCleaning(false);
    }
  };

  const runPolicy = async () => {
    setCleaning(true);
    try {
      const result = await api().runHistoryCleanupPolicy();
      forgetDeletedConversations(result.deleted);
      reportResult(result);
      setConfirm(null);
      await refresh();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cleanup.cleanFailed'));
    } finally {
      setCleaning(false);
    }
  };

  const savePolicy = async (patch: Partial<HistoryCleanupPolicy>) => {
    if (!policyState) return;
    const next = { ...policyState.policy, ...patch };
    // A policy without thresholds cannot stay enabled.
    if (next.maxAgeDays == null && next.maxTotalBytes == null) next.enabled = false;
    setSavingPolicy(true);
    try {
      setPolicyState(await api().updateHistoryCleanupPolicy(next));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cleanup.policySaveFailed'));
    } finally {
      setSavingPolicy(false);
    }
  };

  const policy = policyState?.policy;
  const hasThreshold = policy ? policy.maxAgeDays != null || policy.maxTotalBytes != null : false;
  const lastRun = policyState?.lastRun;

  return (
    <div className="flex flex-col gap-4 py-1">
      <Card>
        <div className="flex items-start gap-3">
          <CardHeader className="flex-1">
            <CardTitle>{t('cleanup.todexTitle')}</CardTitle>
            <CardDescription>{t('cleanup.todexHint')}</CardDescription>
          </CardHeader>
          <IconAction icon={RiRefreshLine} size="md" aria-label={t('cleanup.refreshAria')} disabled={loading} onClick={() => void refresh()} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Card variant="secondary" className="gap-1">
            <span className="text-caption-1-regular text-text-secondary">{t('cleanup.count')}</span>
            <span className="text-title-2-medium text-text-primary tabular-nums">{entries.length}</span>
          </Card>
          <Card variant="secondary" className="gap-1">
            <span className="text-caption-1-regular text-text-secondary">{t('cleanup.storage')}</span>
            <span className="text-title-2-medium text-text-primary tabular-nums">{formatStorageBytes(totalBytes)}</span>
          </Card>
        </div>
        {policy?.maxTotalBytes ? (
          <Meter
            label={t('cleanup.capacityLabel')}
            valueLabel={`${formatStorageBytes(totalBytes)} / ${formatStorageBytes(policy.maxTotalBytes)}`}
            value={Math.min(totalBytes, policy.maxTotalBytes)}
            maxValue={policy.maxTotalBytes}
            tone={totalBytes >= policy.maxTotalBytes * 0.9 ? 'warning' : 'accent'}
          />
        ) : null}
        {measuredAt ? <p className="text-caption-1-regular text-text-tertiary">{t('cleanup.measuredAt', { time: formatDateTime(measuredAt) })}</p> : null}
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <CardHeader className="flex-1">
            <CardTitle>{t('cleanup.autoTitle')}</CardTitle>
            <CardDescription>{t('cleanup.autoHint')}</CardDescription>
          </CardHeader>
          <Switch
            aria-label={t('cleanup.autoTitle')}
            isSelected={policy?.enabled ?? false}
            isDisabled={!policy || savingPolicy || !hasThreshold}
            onChange={(enabled) => void savePolicy({ enabled })}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t('cleanup.ageRule')}
            hint={t('cleanup.ageHint')}
            className="w-full"
            popoverClassName="w-(--trigger-width)"
            isDisabled={!policy || savingPolicy}
            selectedKey={policy?.maxAgeDays != null ? String(policy.maxAgeDays) : OFF}
            onSelectionChange={(key) => void savePolicy({ maxAgeDays: key === OFF || key == null ? null : Number(key) })}
          >
            <SelectItem id={OFF} textValue={t('cleanup.off')}>{t('cleanup.off')}</SelectItem>
            {withCurrent(AGE_OPTIONS, policy?.maxAgeDays ?? null).map((days) => (
              <SelectItem key={days} id={String(days)} textValue={t('cleanup.days', { count: days })}>{t('cleanup.days', { count: days })}</SelectItem>
            ))}
          </Select>
          <Select
            label={t('cleanup.capacityRule')}
            hint={t('cleanup.capacityHint')}
            className="w-full"
            popoverClassName="w-(--trigger-width)"
            isDisabled={!policy || savingPolicy}
            selectedKey={policy?.maxTotalBytes != null ? String(policy.maxTotalBytes) : OFF}
            onSelectionChange={(key) => void savePolicy({ maxTotalBytes: key === OFF || key == null ? null : Number(key) })}
          >
            <SelectItem id={OFF} textValue={t('cleanup.off')}>{t('cleanup.off')}</SelectItem>
            {withCurrent(CAPACITY_OPTIONS, policy?.maxTotalBytes ?? null).map((bytes) => (
              <SelectItem key={bytes} id={String(bytes)} textValue={formatStorageBytes(bytes)}>{formatStorageBytes(bytes)}</SelectItem>
            ))}
          </Select>
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
            {policy?.enabled && policyState?.nextRunAt ? <span>{t('cleanup.nextRun', { time: formatDateTime(policyState.nextRunAt) })}</span> : null}
          </div>
          <Button variant="secondary" size="small" disabled={!hasThreshold || cleaning} onClick={() => setConfirm('policy')}>
            {t('cleanup.runNow')}
          </Button>
        </div>
      </Card>

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
            <SelectItem id="largest" textValue={t('cleanup.sortLargest')}>{t('cleanup.sortLargest')}</SelectItem>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-separator-border pb-3">
          <Checkbox
            isSelected={allSelected}
            isIndeterminate={selectedVisible.length > 0 && !allSelected}
            isDisabled={selectable.length === 0}
            onChange={toggleAll}
          >
            {t('cleanup.selectAll')}
          </Checkbox>
          <span className="flex-1 text-caption-1-regular text-text-secondary tabular-nums">
            {selected.size > 0 ? t('cleanup.selectedSummary', { count: selected.size, size: formatStorageBytes(selectedBytes) }) : null}
          </span>
          <Button variant="danger" size="small" leadingIcon={RiDeleteBin6Line} disabled={selected.size === 0 || cleaning} onClick={() => setConfirm('selected')}>
            {t('cleanup.cleanSelected')}
          </Button>
        </div>
        {loading && entries.length === 0 ? (
          <div className="flex justify-center py-8"><SpinnerIcon className="size-5 text-foreground-icon-tertiary" /></div>
        ) : visible.length === 0 ? (
          <EmptyState size="sm" icon={RiChat3Line} title={query ? t('cleanup.noMatches') : t('cleanup.empty')} />
        ) : (
          <ul className="flex flex-col">
            {visible.map((entry) => {
              const active = isActive(entry);
              return (
                <li key={entry.id}>
                  <Checkbox
                    isSelected={selected.has(entry.id)}
                    isDisabled={active}
                    onChange={(on) => toggleOne(entry.id, on)}
                    aria-label={titleOf(entry)}
                    className={cx('w-full rounded-xl px-2 py-2 *:last:flex *:last:min-w-0 *:last:flex-1', !active && 'hover:bg-background-secondary-hover')}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <ProviderIcon provider={entry.provider} className="size-4 shrink-0" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body-medium text-text-primary">{titleOf(entry)}</span>
                        <span className="truncate text-caption-1-regular text-text-tertiary" title={entry.workspace}>
                          {workspaceName(entry.workspace)} · {formatDateTime(entry.updatedAt)}
                        </span>
                      </span>
                      {active ? <Chip color="yellow">{t('cleanup.active')}</Chip> : entry.archivedAt ? <Chip color="neutral">{t('cleanup.archived')}</Chip> : null}
                      <span className="shrink-0 text-body-2-regular text-text-secondary tabular-nums">{formatStorageBytes(entry.bytes)}</span>
                    </span>
                  </Checkbox>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        isOpen={confirm === 'selected'}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={t('cleanup.confirmSelectedTitle', { count: selectedEntries.length })}
        description={t('cleanup.confirmSelectedBody', { size: formatStorageBytes(selectedBytes) })}
        confirmLabel={t('cleanup.cleanSelected')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={cleaning}
        onConfirm={() => void cleanSelected()}
      />
      <ConfirmDialog
        isOpen={confirm === 'policy'}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={t('cleanup.confirmPolicyTitle')}
        description={t('cleanup.confirmPolicyBody')}
        confirmLabel={t('cleanup.runNow')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={cleaning}
        onConfirm={() => void runPolicy()}
      />
    </div>
  );
}

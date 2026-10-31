import { useMemo, useState } from 'react';
import { RiArrowDownSLine, RiArrowLeftRightLine, RiRefreshLine } from '@remixicon/react';
import {
  CONFIG_SYNC_CATEGORIES,
  isConfigSyncSelectable,
  type ConfigSyncCategory,
  type ConfigSyncError,
  type ConfigSyncItem,
} from '@todex/protocol/configSync';
import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from '@todex/protocol/v2';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { cx } from '@/utils/cx';
import { useT, type MessageKey } from '../../i18n';
import { configSyncItemText, type ConfigSyncRow, type ConfigSyncRowStatus } from '../../session/configSyncView';
import { useConfigSync, type ConfigSyncController, type ConfigSyncIneligible, type ConfigSyncPreset, type ConfigSyncSide } from '../../session/useConfigSync';
import type { TodeXSession } from '../../session/useTodeXSession';
import { BackendSelect } from '../ui/backend-select';
import { HighlightedCode } from '../ui/code-block';
import { IconAction } from '../ui/icon-action';
import { ProgressBar } from '../ui/progress-bar';
import { ScrollArea } from '../ui/scroll-area';
import { Spinner } from '../ui/spinner';
import { SETTINGS_ROW, SettingsCard, SettingsNote, SettingsSectionLabel, SettingsSubpage } from './SettingsRows';

type Translate = ReturnType<typeof useT>;

const STATUS_COLORS: Record<ConfigSyncRowStatus, 'lime' | 'cyan' | 'neutral' | 'yellow' | 'rose' | 'purple'> = {
  new: 'lime',
  update: 'cyan',
  same: 'neutral',
  targetChanged: 'yellow',
  conflict: 'rose',
  blocked: 'neutral',
  targetOnly: 'purple',
};

const INELIGIBLE_LABELS: Record<Exclude<ConfigSyncIneligible, null>, MessageKey> = {
  unpaired: 'settings.backendUnpaired',
  disconnected: 'configSync.disconnected',
};

/** Row grid: tick, source cell, status, target cell, disclosure. */
const ROW_GRID = 'grid grid-cols-[1.25rem_minmax(0,1fr)_5.5rem_minmax(0,1fr)_2rem] items-center gap-x-3';

function providerName(group: string): string {
  return PROVIDER_DISPLAY_NAMES[group as ProviderKind] ?? group;
}

/** The row title: what the item is, in the user's words. */
function rowTitle(t: Translate, row: Pick<ConfigSyncRow, 'kind' | 'group' | 'label'>): string {
  switch (row.kind) {
    case 'agentProvider': return `${providerName(row.group)} · ${row.label}`;
    case 'sshSettings': return t('configSync.item.sshSettings');
    case 'outputFilter': return t('configSync.item.outputFilter');
    case 'agentLocal': return t('configSync.item.agentLocal');
    case 'historyCleanup': return t('configSync.item.historyCleanup');
    case 'instructionPreset': return t('configSync.item.instructionPreset', { name: row.label });
    case 'cliInstructions': return t('configSync.item.cliInstructions', { cli: providerName(row.group) });
    case 'cliSetting': return t('configSync.item.cliSetting', { cli: providerName(row.group), key: row.label });
    case 'mcpServer': return `${providerName(row.group)} · ${row.label}`;
    case 'skill': return `${row.group === 'shared' ? t('configSync.sharedSkills') : providerName(row.group)} · ${row.label}`;
    case 'sshHost': return row.label;
  }
}

function rowNotes(t: Translate, row: ConfigSyncRow): Array<{ text: string; tone: 'muted' | 'warning' }> {
  const notes: Array<{ text: string; tone: 'muted' | 'warning' }> = [];
  const entry = row.entry;
  if (!entry) {
    notes.push({ text: t('configSync.hint.targetOnly'), tone: 'muted' });
    return notes;
  }
  if (entry.blocked) {
    const detail = entry.blocked.detail ?? '';
    const text = entry.blocked.code === 'passwordAuth' ? t('configSync.block.passwordAuth')
      : entry.blocked.code === 'unknownIdentity' ? t('configSync.block.unknownIdentity', { path: detail })
        : t('configSync.block.missingKey', { fingerprint: detail });
    notes.push({ text, tone: 'muted' });
  }
  if (entry.status === 'targetChanged') notes.push({ text: t('configSync.hint.targetChanged'), tone: 'warning' });
  if (entry.status === 'conflict') notes.push({ text: t('configSync.hint.conflict'), tone: 'warning' });
  for (const warning of entry.warnings) {
    const text = warning === 'absolutePath' ? t('configSync.warning.absolutePath')
      : warning === 'skillFilesSkipped' ? t('configSync.warning.skillFilesSkipped')
        : t('configSync.warning.skillContentOnly');
    notes.push({ text, tone: 'warning' });
  }
  return notes;
}

/** One side's read state under its picker. */
function SideStatus({ t, side, blocked }: { t: Translate; side: ConfigSyncSide; blocked: ConfigSyncIneligible }) {
  if (blocked) return <Chip variant="caption" color="yellow" className="self-start">{t(INELIGIBLE_LABELS[blocked])}</Chip>;
  if (side.loading) {
    return (
      <span className="flex items-center gap-2 text-body-2-regular text-text-secondary">
        <Spinner size="sm" />
        {t('configSync.reading')}
      </span>
    );
  }
  if (side.failure) return <span role="alert" className="text-body-2-regular text-text-error-primary">{side.failure}</span>;
  if (!side.snapshot) return null;
  return <span className="text-body-2-regular text-text-secondary">{t('configSync.itemCount', { count: side.snapshot.items.length })}</span>;
}

function SidePicker({ t, session, label, hint, side, blocked, disabled, onChange }: {
  t: Translate;
  session: TodeXSession;
  label: string;
  hint: string;
  side: ConfigSyncSide;
  blocked: ConfigSyncIneligible;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const errors: ConfigSyncError[] = side.snapshot?.errors ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <SettingsSectionLabel as="h3" className="w-auto text-text-primary">{label}</SettingsSectionLabel>
        <span className="text-body-2-regular text-text-tertiary">{hint}</span>
      </div>
      <BackendSelect
        profiles={session.backendConnections}
        linkStates={session.backendLinkStatus}
        selectedId={side.backendId}
        onChange={onChange}
        isDisabled={disabled}
        className="w-full"
      />
      <SideStatus t={t} side={side} blocked={blocked} />
      {errors.map(error => (
        <span key={`${error.category}:${error.scope}`} role="alert" className="text-body-2-regular text-text-error-primary">
          {t('configSync.scopeReadFailed', { scope: error.scope, message: error.message })}
        </span>
      ))}
    </div>
  );
}

/** What one side holds for a row, redacted; or a line saying it has none. */
function ValuePane({ t, name, item }: { t: Translate; name: string; item?: ConfigSyncItem }) {
  const text = useMemo(() => (item ? configSyncItemText(item) : ''), [item]);
  const language = /^\s*[[{]/.test(text) ? 'json' : 'plaintext';
  return (
    <div className="flex min-w-0 flex-col overflow-clip rounded-xl border border-border-button-default bg-background-primary-default">
      <div className="truncate border-b border-separator-border px-3 py-1.5 text-caption-1-medium text-text-tertiary">{name}</div>
      {item ? (
        <ScrollArea className="max-h-72">
          {/* Wrapped, not scrolled sideways: the pane is half a settings page wide. */}
          {text
            ? <HighlightedCode code={text} language={language} className="overflow-x-visible [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere]" />
            : <p className="px-3 py-2 text-body-2-regular text-text-tertiary">{t('configSync.emptyValue')}</p>}
        </ScrollArea>
      ) : (
        <p className="px-3 py-2 text-body-2-regular text-text-tertiary">{t('configSync.notOnBackend', { name })}</p>
      )}
    </div>
  );
}

function Cell({ t, row, item }: { t: Translate; row: ConfigSyncRow; item?: ConfigSyncItem }) {
  if (!item) return <span className="text-body-2-regular text-text-placeholder">{t('configSync.absent')}</span>;
  const title = rowTitle(t, row);
  return <span className="truncate text-body-regular text-text-primary" title={title}>{title}</span>;
}

function SyncRow({ t, sync, row, names, locked }: {
  t: Translate;
  sync: ConfigSyncController;
  row: ConfigSyncRow;
  names: { source: string; target: string };
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const result = sync.results.get(row.key);
  const selectable = Boolean(row.entry && isConfigSyncSelectable(row.entry.status));
  const title = rowTitle(t, row);
  const notes = rowNotes(t, row);
  return (
    <div className={cx('flex flex-col gap-1.5', SETTINGS_ROW)}>
      <div className={ROW_GRID}>
        {row.entry ? (
          <Checkbox
            aria-label={title}
            isSelected={sync.selected.has(row.key)}
            isDisabled={locked || !selectable}
            onChange={on => sync.toggleEntries([row.key], on)}
          />
        ) : <span aria-hidden="true" />}
        <Cell t={t} row={row} item={row.source} />
        <span className="flex justify-center">
          {result
            ? <Chip variant="caption" color={result.ok ? 'lime' : 'rose'}>{result.ok ? t('configSync.result.ok') : t('configSync.result.failed')}</Chip>
            : <Chip variant="caption" color={STATUS_COLORS[row.status]}>{t(`configSync.status.${row.status}`)}</Chip>}
        </span>
        <Cell t={t} row={row} item={row.target} />
        <IconAction
          icon={RiArrowDownSLine}
          size="sm"
          aria-label={open ? t('configSync.hideValue') : t('configSync.showValue')}
          aria-expanded={open}
          tooltip
          active={open}
          iconClassName={cx('transition-transform duration-150', open && 'rotate-180')}
          onClick={() => setOpen(value => !value)}
        />
      </div>
      {notes.length || (result && !result.ok) ? (
        <div className="flex flex-col ps-8">
          {notes.map(note => (
            <span key={note.text} className={cx('text-body-2-regular', note.tone === 'warning' ? 'text-status-yellow-text' : 'text-text-secondary')}>
              {note.text}
            </span>
          ))}
          {result && !result.ok ? <span className="text-body-2-regular text-text-error-primary">{result.error}</span> : null}
        </div>
      ) : null}
      {open ? (
        <div className="grid grid-cols-1 gap-2 pt-1 ps-8 @lg:grid-cols-2">
          <ValuePane t={t} name={names.source} item={row.source} />
          <ValuePane t={t} name={names.target} item={row.target} />
        </div>
      ) : null}
    </div>
  );
}

function CategorySection({ t, sync, category, rows, names, locked }: {
  t: Translate;
  sync: ConfigSyncController;
  category: ConfigSyncCategory;
  rows: ConfigSyncRow[];
  names: { source: string; target: string };
  locked: boolean;
}) {
  // Categories outside the page's preset start folded: visible, but not the focus.
  const [open, setOpen] = useState(() => sync.categories.includes(category));
  const [showSame, setShowSame] = useState(false);
  // A row that was just written stays in view even though it now matches.
  const isSame = (row: ConfigSyncRow) => row.status === 'same' && !sync.results.has(row.key);
  const same = rows.filter(isSame);
  const shown = showSame ? rows : rows.filter(row => !isSame(row));
  const selectable = rows.filter(row => row.entry && isConfigSyncSelectable(row.entry.status)).map(row => row.key);
  const ticked = selectable.filter(key => sync.selected.has(key)).length;
  const allOn = selectable.length > 0 && ticked === selectable.length;
  const label = t(`configSync.category.${category}`);
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <div className="flex items-center gap-2 px-3">
        <button
          type="button"
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          onClick={() => setOpen(value => !value)}
        >
          <RiArrowDownSLine aria-hidden className={cx('size-4 shrink-0 text-foreground-icon-tertiary transition-transform duration-150', !open && '-rotate-90 rtl:rotate-90')} />
          <SettingsSectionLabel as="h4" className="w-auto">{label}</SettingsSectionLabel>
          <span className="truncate text-body-2-regular text-text-tertiary">
            {t('configSync.categoryCount', { selected: ticked, total: rows.length })}
          </span>
        </button>
        {selectable.length > 1 && !locked ? (
          <Button size="small" variant="ghost" onClick={() => sync.toggleEntries(selectable, !allOn)}>
            {allOn ? t('configSync.selectNone') : t('configSync.selectAll')}
          </Button>
        ) : null}
      </div>
      {open ? (
        <SettingsCard>
          {shown.map(row => <SyncRow key={row.key} t={t} sync={sync} row={row} names={names} locked={locked} />)}
          {same.length ? (
            <div className={SETTINGS_ROW}>
              <Button size="small" variant="ghost" onClick={() => setShowSame(value => !value)}>
                {showSame ? t('configSync.hideSame') : t('configSync.showSame', { count: same.length })}
              </Button>
            </div>
          ) : null}
        </SettingsCard>
      ) : null}
    </section>
  );
}

/**
 * Settings → Backend connections → Config sync: two backends side by side,
 * each read as soon as it is picked. Every CLI account, setting, MCP server,
 * skill and key-auth SSH host is lined up with its counterpart; the ticked
 * ones are written to the target, which never loses anything.
 */
export function ConfigSyncSettings({ session, onBack, preset }: {
  session: TodeXSession;
  onBack: () => void;
  /** Initial pair and preselected categories; read once on mount. */
  preset?: ConfigSyncPreset;
}) {
  const t = useT();
  const sync = useConfigSync(session, preset);
  const nameOf = (id: string) => session.backendConnections.find(profile => profile.id === id)?.name ?? id;
  const names = { source: nameOf(sync.source.backendId), target: nameOf(sync.target.backendId) };
  const loading = sync.source.loading || sync.target.loading;
  const locked = sync.applying;
  const selectedCount = sync.selected.size;

  const counts = useMemo(() => {
    let pending = 0; let same = 0; let targetOnly = 0;
    for (const row of sync.rows) {
      if (row.status === 'same') same += 1;
      else if (row.status === 'targetOnly') targetOnly += 1;
      else if (row.status !== 'blocked') pending += 1;
    }
    return { pending, same, targetOnly };
  }, [sync.rows]);
  const failed = [...sync.results.values()].filter(result => !result.ok).length;

  return (
    <SettingsSubpage title={t('configSync.title')} description={t('configSync.description')} onBack={onBack}>
      <div className="flex flex-col gap-6 @container">
        <SettingsCard className="p-4">
          <div className="grid grid-cols-1 items-start gap-3 @lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <SidePicker
              t={t}
              session={session}
              label={t('configSync.source')}
              hint={t('configSync.sourceHint')}
              side={sync.source}
              blocked={sync.sourceBlocked}
              disabled={locked}
              onChange={sync.setSourceId}
            />
            <div className="flex justify-center @lg:pt-7">
              <IconAction
                icon={RiArrowLeftRightLine}
                aria-label={t('configSync.swap')}
                tooltip
                disabled={locked}
                iconClassName="rotate-90 @lg:rotate-0"
                onClick={sync.swap}
              />
            </div>
            <SidePicker
              t={t}
              session={session}
              label={t('configSync.target')}
              hint={t('configSync.targetHint')}
              side={sync.target}
              blocked={sync.targetBlocked}
              disabled={locked}
              onChange={sync.setTargetId}
            />
          </div>
        </SettingsCard>

        {sync.ready ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3">
              <span className="text-body-2-regular text-text-secondary">{t('configSync.summary', counts)}</span>
              <Button size="small" variant="ghost" leadingIcon={RiRefreshLine} disabled={locked || loading} onClick={sync.refresh}>
                {t('configSync.refresh')}
              </Button>
            </div>
            <div className={cx(ROW_GRID, 'ps-3 pe-2.5 text-caption-1-medium text-text-tertiary')} aria-hidden="true">
              <span />
              <span className="truncate">{names.source}</span>
              <span />
              <span className="truncate">{names.target}</span>
              <span />
            </div>
            {CONFIG_SYNC_CATEGORIES.map((category) => {
              const rows = sync.rows.filter(row => row.category === category);
              if (!rows.length) return null;
              return <CategorySection key={category} t={t} sync={sync} category={category} rows={rows} names={names} locked={locked} />;
            })}
            {!sync.rows.length ? <SettingsCard><SettingsNote>{t('configSync.empty')}</SettingsNote></SettingsCard> : null}
            {sync.rows.length && !counts.pending && !sync.results.size
              ? <SettingsCard><SettingsNote>{t('configSync.inSync')}</SettingsNote></SettingsCard>
              : null}
          </div>
        ) : null}

        {sync.applying && sync.progress ? (
          <ProgressBar
            label={t('configSync.applying')}
            value={sync.progress.done}
            maxValue={Math.max(sync.progress.total, 1)}
            valueLabel={`${sync.progress.done} / ${sync.progress.total}`}
          />
        ) : null}
        {sync.applied && sync.results.size ? (
          <SettingsCard>
            <SettingsNote tone={failed ? 'warning' : 'muted'} role="status">
              {t('configSync.done', { ok: sync.results.size - failed, failed })}
            </SettingsNote>
          </SettingsCard>
        ) : null}
        {sync.ready ? (
          <div className="flex items-center justify-end gap-2">
            <Button disabled={locked || loading || selectedCount === 0} onClick={() => void sync.apply()}>
              {t('configSync.apply', { count: selectedCount, name: names.target })}
            </Button>
          </div>
        ) : null}
      </div>
    </SettingsSubpage>
  );
}

import { useMemo } from 'react';
import { RiRefreshLine } from '@remixicon/react';
import {
  CONFIG_SYNC_CATEGORIES,
  isConfigSyncSelectable,
  type ConfigSyncCategory,
  type ConfigSyncEntry,
  type ConfigSyncStatus,
} from '@todex/protocol/configSync';
import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from '@todex/protocol/v2';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { cx } from '@/utils/cx';
import { useT, type MessageKey } from '../../i18n';
import { backendLabelColor } from '../../session/backendColors';
import { useConfigSync, type ConfigSyncIneligible, type ConfigSyncPreset, type ConfigSyncTargetPlan } from '../../session/useConfigSync';
import type { TodeXSession } from '../../session/useTodeXSession';
import { BackendSelect } from '../ui/backend-select';
import { ProgressBar } from '../ui/progress-bar';
import { SpinnerIcon } from '../ui/spinner';
import { SETTINGS_ROW, SettingsCard, SettingsGroup, SettingsNote, SettingsRow, SettingsSectionLabel, SettingsSubpage } from './SettingsRows';

type Translate = ReturnType<typeof useT>;

const STATUS_COLORS: Record<ConfigSyncStatus, 'lime' | 'cyan' | 'neutral' | 'yellow' | 'rose'> = {
  new: 'lime',
  update: 'cyan',
  same: 'neutral',
  targetChanged: 'yellow',
  conflict: 'rose',
  blocked: 'neutral',
};

const INELIGIBLE_LABELS: Record<Exclude<ConfigSyncIneligible, null>, MessageKey> = {
  unpaired: 'settings.backendUnpaired',
  disconnected: 'configSync.disconnected',
};

function providerName(group: string): string {
  return PROVIDER_DISPLAY_NAMES[group as ProviderKind] ?? group;
}

/** The row title: what the item is, in the user's words. */
function entryTitle(t: Translate, entry: ConfigSyncEntry): string {
  switch (entry.kind) {
    case 'agentProvider': return `${providerName(entry.group)} · ${entry.label}`;
    case 'sshSettings': return t('configSync.item.sshSettings');
    case 'outputFilter': return t('configSync.item.outputFilter');
    case 'agentLocal': return t('configSync.item.agentLocal');
    case 'historyCleanup': return t('configSync.item.historyCleanup');
    case 'instructionPreset': return t('configSync.item.instructionPreset', { name: entry.label });
    case 'cliInstructions': return t('configSync.item.cliInstructions', { cli: providerName(entry.group) });
    case 'cliSetting': return t('configSync.item.cliSetting', { cli: providerName(entry.group), key: entry.label });
    case 'mcpServer': return `${providerName(entry.group)} · ${entry.label}`;
    case 'skill': return `${entry.group === 'shared' ? t('configSync.sharedSkills') : providerName(entry.group)} · ${entry.label}`;
    case 'sshHost': return entry.label;
  }
}

function entryNotes(t: Translate, entry: ConfigSyncEntry): Array<{ text: string; tone: 'muted' | 'warning' }> {
  const notes: Array<{ text: string; tone: 'muted' | 'warning' }> = [];
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

function EntryRow({ t, plan, entry, locked, onToggle }: {
  t: Translate;
  plan: ConfigSyncTargetPlan;
  entry: ConfigSyncEntry;
  locked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const result = plan.results.get(entry.key);
  const selectable = isConfigSyncSelectable(entry.status);
  const title = entryTitle(t, entry);
  const notes = entryNotes(t, entry);
  return (
    <div className={cx('flex min-h-[52px] items-center gap-3', SETTINGS_ROW)}>
      <Checkbox
        aria-label={title}
        isSelected={plan.selected.has(entry.key)}
        isDisabled={locked || !selectable}
        onChange={onToggle}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-regular text-text-primary" title={title}>{title}</span>
        {notes.map((note) => (
          <span key={note.text} className={cx('text-body-2-regular', note.tone === 'warning' ? 'text-status-yellow-text' : 'text-text-secondary')}>
            {note.text}
          </span>
        ))}
        {result && !result.ok ? <span className="text-body-2-regular text-text-error-primary">{result.error}</span> : null}
      </div>
      {result
        ? <Chip variant="caption" color={result.ok ? 'lime' : 'rose'}>{result.ok ? t('configSync.result.ok') : t('configSync.result.failed')}</Chip>
        : <Chip variant="caption" color={STATUS_COLORS[entry.status]}>{t(`configSync.status.${entry.status}`)}</Chip>}
    </div>
  );
}

function TargetPreview({ t, plan, name, locked, onToggle }: {
  t: Translate;
  plan: ConfigSyncTargetPlan;
  name: string;
  locked: boolean;
  onToggle: (keys: string[], on: boolean) => void;
}) {
  // Unchanged items are only counted: the preview lists what sync would touch.
  const shown = plan.entries.filter(entry => entry.status !== 'same' || plan.results.has(entry.key));
  const unchanged = plan.entries.length - shown.length;
  const pending = plan.entries.filter(entry => entry.status !== 'same' && entry.status !== 'blocked').length;
  return (
    <SettingsGroup
      label={t('configSync.toTarget', { name })}
      description={t('configSync.summary', { pending, unchanged })}
    >
      {plan.errors.map((error) => (
        <SettingsCard key={`${error.category}:${error.scope}`}>
          <SettingsNote tone="danger" role="alert">{t('configSync.readFailed', { scope: error.scope, message: error.message })}</SettingsNote>
        </SettingsCard>
      ))}
      {CONFIG_SYNC_CATEGORIES.map((category) => {
        const entries = shown.filter(entry => entry.category === category);
        if (!entries.length) return null;
        const selectable = entries.filter(entry => isConfigSyncSelectable(entry.status)).map(entry => entry.key);
        const allOn = selectable.length > 0 && selectable.every(key => plan.selected.has(key));
        return (
          <div key={category} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 px-3">
              <SettingsSectionLabel as="h4">{t(`configSync.category.${category}`)}</SettingsSectionLabel>
              {selectable.length > 1 && !locked ? (
                <Button size="small" variant="ghost" onClick={() => onToggle(selectable, !allOn)}>
                  {allOn ? t('configSync.selectNone') : t('configSync.selectAll')}
                </Button>
              ) : null}
            </div>
            <SettingsCard>
              {entries.map((entry) => (
                <EntryRow key={entry.key} t={t} plan={plan} entry={entry} locked={locked} onToggle={on => onToggle([entry.key], on)} />
              ))}
            </SettingsCard>
          </div>
        );
      })}
      {!shown.length && !plan.errors.length ? (
        <SettingsCard><SettingsNote>{t('configSync.upToDate')}</SettingsNote></SettingsCard>
      ) : null}
    </SettingsGroup>
  );
}

/**
 * Settings → Backend connections → Config sync: copies CLI accounts,
 * settings, MCP servers, skills and key-auth SSH hosts from one backend to
 * others, writing only what changed and never deleting.
 */
export function ConfigSyncSettings({ session, onBack, preset }: {
  session: TodeXSession;
  onBack: () => void;
  /** Initial source, targets and categories; read once on mount. */
  preset?: ConfigSyncPreset;
}) {
  const t = useT();
  const sync = useConfigSync(session, preset);
  const profiles = session.backendConnections;
  const nameOf = useMemo(() => new Map(profiles.map(profile => [profile.id, profile.name])), [profiles]);
  const sourceBlocked = sync.ineligibility(sync.sourceId);
  const busy = sync.phase === 'checking' || sync.phase === 'applying';
  const canCheck = !busy && !sourceBlocked && sync.targetIds.length > 0 && sync.categories.length > 0
    && sync.targetIds.every(id => !sync.ineligibility(id));

  return (
    <SettingsSubpage title={t('configSync.title')} description={t('configSync.description')} onBack={onBack}>
      <SettingsGroup label={t('configSync.direction')}>
        <SettingsCard>
          <SettingsRow
            label={t('configSync.source')}
            description={sourceBlocked ? t(INELIGIBLE_LABELS[sourceBlocked]) : t('configSync.sourceHint')}
          >
            <BackendSelect
              profiles={profiles}
              linkStates={session.backendLinkStatus}
              selectedId={sync.sourceId}
              onChange={sync.setSourceId}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('configSync.targets')} description={t('configSync.targetsHint')}>
        <SettingsCard>
          {profiles.filter(profile => profile.id !== sync.sourceId).map((profile) => {
            const blocked = sync.ineligibility(profile.id);
            return (
              <SettingsRow
                key={profile.id}
                label={(
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: backendLabelColor(profile) }} />
                    <span className="truncate">{profile.name}</span>
                  </span>
                )}
                description={profile.serverUrl}
              >
                {blocked ? <Chip variant="caption" color="yellow">{t(INELIGIBLE_LABELS[blocked])}</Chip> : null}
                <Checkbox
                  aria-label={profile.name}
                  isDisabled={busy || Boolean(blocked)}
                  isSelected={sync.targetIds.includes(profile.id)}
                  onChange={on => sync.toggleTarget(profile.id, on)}
                />
              </SettingsRow>
            );
          })}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('configSync.content')}>
        <SettingsCard>
          {CONFIG_SYNC_CATEGORIES.map((category: ConfigSyncCategory) => (
            <SettingsRow
              key={category}
              label={t(`configSync.category.${category}`)}
              description={t(`configSync.categoryHint.${category}`)}
              align="start"
            >
              <Checkbox
                aria-label={t(`configSync.category.${category}`)}
                isDisabled={busy}
                isSelected={sync.categories.includes(category)}
                onChange={on => sync.toggleCategory(category, on)}
              />
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsGroup>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant={sync.phase === 'idle' ? 'primary' : 'secondary'}
          leadingIcon={sync.phase === 'checking' ? SpinnerIcon : RiRefreshLine}
          disabled={!canCheck}
          onClick={() => void sync.check()}
        >
          {sync.phase === 'checking' ? t('configSync.checking') : t('configSync.check')}
        </Button>
      </div>

      {sync.failure ? <SettingsCard><SettingsNote tone="danger" role="alert">{sync.failure}</SettingsNote></SettingsCard> : null}
      {sync.sourceErrors.length ? (
        <SettingsCard>
          {sync.sourceErrors.map((error) => (
            <SettingsNote key={`${error.category}:${error.scope}`} tone="danger" role="alert">
              {t('configSync.sourceReadFailed', { scope: error.scope, message: error.message })}
            </SettingsNote>
          ))}
        </SettingsCard>
      ) : null}

      {sync.plans.map((plan) => (
        <TargetPreview
          key={plan.backendId}
          t={t}
          plan={plan}
          name={nameOf.get(plan.backendId) ?? plan.backendId}
          locked={sync.phase !== 'ready'}
          onToggle={(keys, on) => sync.toggleEntry(plan.backendId, keys, on)}
        />
      ))}

      {sync.phase === 'applying' && sync.progress ? (
        <ProgressBar
          label={t('configSync.applying')}
          value={sync.progress.done}
          maxValue={Math.max(sync.progress.total, 1)}
          valueLabel={`${sync.progress.done} / ${sync.progress.total}`}
        />
      ) : null}

      {sync.phase === 'ready' ? (
        <div className="flex items-center justify-end gap-2">
          <Button disabled={sync.selectedCount === 0} onClick={() => void sync.apply()}>
            {t('configSync.apply', { count: sync.selectedCount })}
          </Button>
        </div>
      ) : null}
      {sync.phase === 'done' ? (
        <SettingsCard><SettingsNote>{t('configSync.done')}</SettingsNote></SettingsCard>
      ) : null}
    </SettingsSubpage>
  );
}

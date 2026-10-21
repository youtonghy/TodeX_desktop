import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RiAddLine, RiDeleteBin6Line, RiSearchLine, RiSettings3Line } from '@remixicon/react';
import type {
  DshPackage,
  DshPluginConfigDocument,
  DshPluginConfigId,
  DshPluginList,
  DshPluginOperation,
  DshPluginRow,
  V2ApiClient,
} from '@todex/protocol/v2';
import { isConflictError } from '@todex/protocol/connectionError';
import { Button } from '@/components/base/buttons/button';
import { Chip } from '@/components/base/badges/chip';
import { Input } from '@/components/base/input/input';
import { Switch } from '@/components/base/switch/switch';
import { Alert } from '@/components/ui/alert';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmDialog } from '@/components/ui/modal';
import { Spinner, SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { SettingsCard, SettingsGroup, SettingsRow, SettingsSubpage } from '@/components/settings/SettingsRows';
import { useT, type MessageKey } from '@/i18n';
import { fieldId, getAt, setAt, type SettingsObject } from '@/lib/cliSettings';
import { DSH_PLUGIN_PAGES, dshRowSourceLabel, filterDshRows, isDshPluginConfigId } from '@/lib/dshPlugins';
import { SettingsField } from './SettingsFields';

const key = (value: string) => value as MessageKey;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const POLL_MS = 1500;

type Page = {
  id: DshPluginConfigId;
  doc?: DshPluginConfigDocument;
  loadError?: string;
  draft: SettingsObject;
};

type Confirm =
  | { action: 'install' | 'remove'; source: string }
  | { action: 'allow-version' | 'revoke-version'; source: string; runtimeVersion: string };

/**
 * DeepSeek Harness's composed acp profile: plugin rows, installed bundles
 * and version exemptions, plus the settings page of a known plugin. Toggles
 * and package operations apply at once; a settings page is saved through
 * the modal's Save button.
 */
export function useDshPlugins(active: boolean, api: () => V2ApiClient, onChanged: () => void) {
  const t = useT();
  const [list, setList] = useState<DshPluginList>();
  const [loadError, setLoadError] = useState<string>();
  const [toggling, setToggling] = useState<string>();
  const [page, setPage] = useState<Page | null>(null);
  const [saving, setSaving] = useState(false);
  const [operation, setOperation] = useState<DshPluginOperation>();
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      setList(await api().listDshPlugins());
    } catch (error) {
      setLoadError(errorText(error, t('dshPlugins.readFailed')));
    }
  }, [api]);

  useEffect(() => { if (active) void load(); }, [active, load]);

  const run = async (id: string, write: (current: DshPluginList) => Promise<DshPluginList>) => {
    if (!list) return;
    setToggling(id);
    try {
      setList(await write(list));
      changed.current();
    } catch (error) {
      if (isConflictError(error)) {
        toast.warning(t('dshPlugins.conflict'));
        await load();
      } else {
        toast.danger(errorText(error, t('dshPlugins.saveFailed')));
      }
    } finally {
      setToggling(undefined);
    }
  };

  const toggleRow = (id: string, enabled: boolean) => run(`row:${id}`, (current) => api().setDshPluginState(current.revision, id, enabled));
  const toggleBundle = (name: string, enabled: boolean) => run(`bundle:${name}`, (current) => api().setDshBundleSelected(current.manifestRevision, name, enabled));

  // Polls a running package operation until it ends.
  useEffect(() => {
    if (!operation || operation.status !== 'running') return;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api().getDshPluginOperation(operation.id);
        setOperation(next);
        if (next.status === 'running') return;
        const name = next.source;
        if (next.status === 'succeeded') {
          toast.success(t(key(`dshPlugins.done.${next.action}`), { name }));
        } else if (!next.incompatible?.length) {
          toast.danger(t('dshPlugins.operationFailed', { name, message: next.error ?? '' }));
        }
        await load();
        changed.current();
      } catch (error) {
        setOperation({ ...operation, status: 'failed', error: errorText(error, t('dshPlugins.readFailed')) });
      }
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [operation, api, load]);

  const startOperation = async (request: Confirm) => {
    try {
      const options = 'runtimeVersion' in request
        ? { runtimeVersion: request.runtimeVersion, acceptRisk: request.action === 'allow-version' }
        : {};
      setOperation(await api().startDshPluginOperation(request.action, request.source, options));
      return true;
    } catch (error) {
      toast.danger(errorText(error, t('dshPlugins.saveFailed')));
      return false;
    }
  };

  const openPage = async (id: DshPluginConfigId) => {
    setPage({ id, draft: {} });
    try {
      const doc = await api().getDshPluginConfig(id);
      setPage((current) => (current?.id === id ? { ...current, doc, draft: doc.config } : current));
    } catch (error) {
      setPage((current) => (current?.id === id ? { ...current, loadError: errorText(error, t('dshPlugins.readFailed')) } : current));
    }
  };

  /** Top-level fields that differ from the composed values; `null` restores one. */
  const patch = useMemo(() => {
    const saved = page?.doc?.config;
    if (!page || !saved) return {};
    const fields = DSH_PLUGIN_PAGES[page.id].groups.flatMap((group) => group.fields.map((field) => field.path[0]));
    return Object.fromEntries(fields
      .filter((field) => JSON.stringify(page.draft[field]) !== JSON.stringify(saved[field]))
      .map((field) => [field, page.draft[field] ?? null]));
  }, [page]);
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    if (!page?.doc || !dirty) return;
    setSaving(true);
    try {
      const doc = await api().patchDshPluginConfig(page.id, page.doc.revision, patch);
      setPage({ ...page, doc, draft: doc.config });
      toast.success(t('dshPlugins.pageSaved', { name: page.id }));
      changed.current();
    } catch (error) {
      if (!isConflictError(error)) {
        toast.danger(errorText(error, t('dshPlugins.saveFailed')));
        return;
      }
      // Changed elsewhere: reload and keep the edits on top for review.
      try {
        const latest = await api().getDshPluginConfig(page.id);
        setPage({ ...page, doc: latest, draft: { ...latest.config, ...page.draft } });
        toast.warning(t('dshPlugins.conflict'));
      } catch (reloadError) {
        toast.danger(errorText(reloadError, t('dshPlugins.readFailed')));
      }
    } finally {
      setSaving(false);
    }
  };

  return {
    list,
    loadError,
    load,
    toggling,
    toggleRow,
    toggleBundle,
    operation,
    clearOperation: () => setOperation(undefined),
    startOperation,
    page,
    openPage,
    closePage: () => setPage(null),
    setDraft: (update: (draft: SettingsObject) => SettingsObject) => setPage((current) => (current ? { ...current, draft: update(current.draft) } : current)),
    dirty,
    saving,
    canSave: Boolean(page?.doc) && !page?.doc?.overridden && dirty && !saving,
    save,
  };
}

export type DshPluginsState = ReturnType<typeof useDshPlugins>;

export function DshPluginsPanel({ state }: { state: DshPluginsState }) {
  const t = useT();
  const { list, loadError, page, operation } = state;
  const [installSource, setInstallSource] = useState('');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const running = operation?.status === 'running';
  const busy = running || Boolean(state.toggling);

  const groups = useMemo(() => {
    const byLabel = new Map<string, DshPluginRow[]>();
    for (const row of filterDshRows(list?.rows ?? [], query)) {
      const label = dshRowSourceLabel(row);
      byLabel.set(label, [...(byLabel.get(label) ?? []), row]);
    }
    return [...byLabel.entries()];
  }, [list, query]);

  if (page) return <PluginPage state={state} page={page} />;
  if (loadError) {
    return (
      <Alert
        status="danger"
        title={t('dshPlugins.readFailed')}
        description={loadError}
        actions={<Button size="small" variant="secondary" onClick={() => void state.load()}>{t('cliSettings.retry')}</Button>}
      />
    );
  }
  if (!list) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('dshPlugins.reading')} /></div>;
  }

  const refused = operation?.status === 'failed' ? operation.incompatible ?? [] : [];

  return (
    <div className="flex flex-col gap-5">
      <p className="px-3 text-body-2-regular text-text-secondary">
        {t('dshPlugins.intro', { version: list.runtimeVersion ?? '?' })}
      </p>
      {list.composeError ? (
        <Alert
          status="danger"
          title={t('dshPlugins.composeError')}
          description={list.composeError}
          actions={<Button size="small" variant="secondary" onClick={() => void state.load()}>{t('cliSettings.retry')}</Button>}
        />
      ) : null}
      {list.parseError ? <Alert status="warning" title={t('dshPlugins.parseError')} description={list.parseError} /> : null}
      <SettingsGroup label={t('dshPlugins.packages')} description={t('dshPlugins.packagesHint')}>
        <SettingsCard>
          {list.packages.map((pkg) => (
            <PackageRow key={pkg.name} pkg={pkg} state={state} busy={busy} onRemove={() => setConfirm({ action: 'remove', source: pkg.name })} />
          ))}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('dshPlugins.install')} description={t(list.pnpmAvailable ? 'dshPlugins.installHint' : 'dshPlugins.noPnpm')}>
        <SettingsCard>
          <div className="flex items-center gap-2 py-2.5 pe-2.5">
            <Input
              aria-label={t('dshPlugins.installSource')}
              size="small"
              className="min-w-0 flex-1"
              inputDir="ltr"
              placeholder="@scope/dsh-plugin"
              value={installSource}
              onChange={setInstallSource}
              inputClassName="font-mono"
              isDisabled={!list.pnpmAvailable}
            />
            <Button
              size="small"
              variant="secondary"
              leadingIcon={RiAddLine}
              disabled={!installSource.trim() || running || !list.pnpmAvailable}
              onClick={() => setConfirm({ action: 'install', source: installSource.trim() })}
            >
              {t('dshPlugins.installAction')}
            </Button>
          </div>
        </SettingsCard>
      </SettingsGroup>

      {running && operation ? (
        <Alert status="info" icon={SpinnerIcon} title={t(key(`dshPlugins.running.${operation.action}`), { name: operation.source })} />
      ) : null}
      {refused.map((item) => (
        <Alert
          key={item.package}
          status="warning"
          title={t('dshPlugins.incompatibleTitle', { name: item.package, version: item.runtimeVersion })}
          description={operation?.error}
          actions={(
            <div className="flex gap-2">
              <Button size="small" variant="secondary" onClick={() => setConfirm({ action: 'allow-version', source: item.package, runtimeVersion: item.runtimeVersion })}>
                {t('dshPlugins.allowAction')}
              </Button>
              <Button size="small" variant="ghost" onClick={state.clearOperation}>{t('common.close')}</Button>
            </div>
          )}
        />
      ))}

      {list.exemptions.length ? (
        <SettingsGroup label={t('dshPlugins.exemptions')} description={t('dshPlugins.exemptionsHint')}>
          <SettingsCard>
            {list.exemptions.flatMap((exemption) => exemption.runtimeVersions.map((runtimeVersion) => (
              <SettingsRow
                key={`${exemption.package}@${runtimeVersion}`}
                label={<span className="truncate font-mono text-body-2-medium" dir="ltr">{exemption.package}</span>}
                description={t('dshPlugins.exemptionFor', { version: runtimeVersion })}
              >
                <Button size="small" variant="ghost" disabled={running}
                  onClick={() => setConfirm({ action: 'revoke-version', source: exemption.package, runtimeVersion })}>
                  {t('dshPlugins.revokeAction')}
                </Button>
              </SettingsRow>
            )))}
          </SettingsCard>
        </SettingsGroup>
      ) : null}

      <SettingsGroup label={t('dshPlugins.rows', { count: list.rows.length })} description={t('dshPlugins.rowsHint')}>
        <Input
          aria-label={t('dshPlugins.search')}
          size="small"
          leadingIcon={RiSearchLine}
          placeholder={t('dshPlugins.search')}
          value={query}
          onChange={setQuery}
        />
      </SettingsGroup>
      {groups.map(([label, rows]) => (
        <SettingsGroup key={label} label={<span className="font-mono" dir="ltr">{label}</span>}>
          <SettingsCard>
            {rows.map((row, index) => <RowItem key={row.id ?? `${row.name}-${index}`} row={row} state={state} busy={busy} />)}
          </SettingsCard>
        </SettingsGroup>
      ))}
      <p className="px-3 text-body-2-regular text-text-secondary">{t('dshPlugins.applies')}</p>

      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm ? t(key(`dshPlugins.confirm.${confirm.action}.title`)) : ''}
        description={confirm ? t(key(`dshPlugins.confirm.${confirm.action}.body`), { name: confirm.source, version: 'runtimeVersion' in confirm ? confirm.runtimeVersion : '' }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={confirm ? t(key(`dshPlugins.confirm.${confirm.action}.action`)) : ''}
        tone={confirm?.action === 'install' || confirm?.action === 'revoke-version' ? 'default' : 'danger'}
        onConfirm={async () => {
          if (!confirm) return;
          const started = await state.startOperation(confirm);
          if (started && confirm.action === 'install') setInstallSource('');
          setConfirm(null);
        }}
      />
    </div>
  );
}

function PackageRow({ pkg, state, busy, onRemove }: { pkg: DshPackage; state: DshPluginsState; busy: boolean; onRemove: () => void }) {
  const t = useT();
  return (
    <SettingsRow
      label={(
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-mono text-body-2-medium" dir="ltr" title={pkg.spec ?? pkg.name}>{pkg.name}</span>
          {pkg.version ? <span className="shrink-0 text-caption-1-regular text-text-tertiary" dir="ltr">{pkg.version}</span> : null}
        </span>
      )}
      description={pkg.description ?? (pkg.builtin ? t('dshPlugins.builtinBundle') : undefined)}
    >
      {pkg.builtin ? <Chip variant="caption" color="neutral">{t('dshPlugins.builtin')}</Chip> : null}
      {!pkg.builtin && !pkg.bundle ? <Chip variant="caption" color="orange">{t('dshPlugins.notBundle')}</Chip> : null}
      {pkg.builtin ? <span className="size-7" aria-hidden /> : (
        <IconAction icon={RiDeleteBin6Line} size="sm" tooltip={t('dshPlugins.removeAction')} aria-label={t('dshPlugins.removeOf', { name: pkg.name })} disabled={busy} onClick={onRemove} />
      )}
      <Switch
        size="sm"
        aria-label={t('dshPlugins.enable', { name: pkg.name })}
        isSelected={pkg.selected}
        isDisabled={pkg.builtin || !pkg.bundle || busy}
        onChange={(enabled) => void state.toggleBundle(pkg.name, enabled)}
      />
    </SettingsRow>
  );
}

function RowItem({ row, state, busy }: { row: DshPluginRow; state: DshPluginsState; busy: boolean }) {
  const t = useT();
  const label = row.id ?? row.name;
  const enabled = row.state.kind === 'enabled';
  return (
    <SettingsRow
      label={<span className="truncate font-mono text-body-2-medium" dir="ltr">{label}</span>}
      description={<span className="font-mono text-caption-1-regular" dir="ltr">{row.name}</span>}
    >
      {row.locked ? <Chip variant="caption" color="blue">{t('dshPlugins.locked')}</Chip> : null}
      {row.overridden ? <Chip variant="caption" color="yellow">{t('dshPlugins.overridden')}</Chip> : null}
      {row.state.kind === 'conditional' ? (
        <span title={row.state.expression}><Chip variant="caption" color="neutral">{t('dshPlugins.conditional')}</Chip></span>
      ) : null}
      {row.configurable && isDshPluginConfigId(row.id) ? (
        <IconAction icon={RiSettings3Line} size="sm" tooltip={t('dshPlugins.settings')} aria-label={t('dshPlugins.settingsOf', { name: label })}
          onClick={() => void state.openPage(row.id as DshPluginConfigId)} />
      ) : null}
      <Switch
        size="sm"
        aria-label={t('dshPlugins.enable', { name: label })}
        isSelected={enabled}
        isDisabled={!row.toggleable || busy}
        onChange={(next) => void state.toggleRow(row.id!, next)}
      />
    </SettingsRow>
  );
}

function PluginPage({ state, page }: { state: DshPluginsState; page: Page }) {
  const t = useT();
  const spec = DSH_PLUGIN_PAGES[page.id];
  const prefix = `dshPlugins.${page.id}`;
  return (
    <SettingsSubpage
      title={<span className="font-mono" dir="ltr">{page.id}</span>}
      description={t(key(`${prefix}.summary`))}
      onBack={() => {
        if (state.dirty) toast.warning(t('dshPlugins.discarded'));
        state.closePage();
      }}
    >
      {page.loadError ? (
        <Alert
          status="danger"
          title={t('dshPlugins.readFailed')}
          description={page.loadError}
          actions={<Button size="small" variant="secondary" onClick={() => void state.openPage(page.id)}>{t('cliSettings.retry')}</Button>}
        />
      ) : !page.doc ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('dshPlugins.reading')} /></div>
      ) : (
        <>
          {page.doc.overridden ? <Alert status="warning" title={t('dshPlugins.pageOverridden')} /> : null}
          {spec.groups.map((group) => (
            <SettingsGroup key={group.id} label={t(key(`${prefix}.group.${group.id}`))}>
              <SettingsCard>
                {group.fields.map((field) => (
                  <SettingsField
                    key={fieldId(field.path)}
                    field={field}
                    keyPrefix={prefix}
                    value={getAt(page.draft, field.path)}
                    onChange={(value) => state.setDraft((draft) => setAt(draft, field.path, value))}
                  />
                ))}
              </SettingsCard>
            </SettingsGroup>
          ))}
          <p className="px-3 text-body-2-regular text-text-secondary">{t('dshPlugins.pageApplies')}</p>
        </>
      )}
    </SettingsSubpage>
  );
}

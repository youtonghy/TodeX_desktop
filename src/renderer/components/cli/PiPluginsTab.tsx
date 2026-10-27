import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RiAddLine, RiDeleteBin6Line, RiSettings3Line } from '@remixicon/react';
import type {
  PiBuiltinExtensionId,
  PiPackage,
  PiPackageOperation,
  PiPluginConfigDocument,
  PiPluginConfigId,
  PiPluginList,
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
import { applyMergePatch, fieldId, getAt, mergePatch, setAt, type SettingsObject } from '@/lib/cliSettings';
import {
  PI_PLUGIN_CATEGORIES,
  PI_PLUGIN_PAGES,
  knownPiPlugin,
  piPackageName,
  type PiPluginCategory,
  type PiRpcSupport,
} from '@/lib/piPlugins';
import { PiSubagentTemplateEditor, PiSubagentTemplatesSection, usePiSubagentTemplates } from './PiSubagentTemplates';
import { SettingsField } from './SettingsFields';

const key = (value: string) => value as MessageKey;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const POLL_MS = 1500;

type Page = {
  config: PiPluginConfigId;
  title: string;
  summary?: string;
  doc?: PiPluginConfigDocument;
  loadError?: string;
  draft: SettingsObject;
};

/**
 * The Pi packages and built-in extensions of `settings.json`, and the
 * settings page of one known extension. Switches, installs and removals
 * apply at once; a settings page is saved through the modal's Save button,
 * as is the subagent template open on the subagents page.
 * `onSettingsChanged` runs after `settings.json` changed here.
 */
export function usePiPlugins(active: boolean, api: () => V2ApiClient, onSettingsChanged: () => void) {
  const t = useT();
  const [list, setList] = useState<PiPluginList>();
  const [loadError, setLoadError] = useState<string>();
  const [toggling, setToggling] = useState<string>();
  const [page, setPage] = useState<Page | null>(null);
  const [saving, setSaving] = useState(false);
  const [operation, setOperation] = useState<PiPackageOperation>();
  const changed = useRef(onSettingsChanged);
  changed.current = onSettingsChanged;
  const templates = usePiSubagentTemplates(active && page?.config === 'subagents', api);
  const editingTemplate = Boolean(templates.editor);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      setList(await api().listPiPlugins());
    } catch (error) {
      setLoadError(errorText(error, t('piPlugins.readFailed')));
    }
  }, [api]);

  useEffect(() => { if (active) void load(); }, [active, load]);

  const toggle = async (target: { source: string } | { builtin: PiBuiltinExtensionId }, enabled: boolean) => {
    if (!list) return;
    const id = 'source' in target ? target.source : `builtin:${target.builtin}`;
    setToggling(id);
    try {
      setList(await api().setPiPluginState(list.revision, target, enabled));
      changed.current();
    } catch (error) {
      if (isConflictError(error)) {
        toast.warning(t('piPlugins.conflict'));
        await load();
      } else {
        toast.danger(errorText(error, t('piPlugins.saveFailed')));
      }
    } finally {
      setToggling(undefined);
    }
  };

  // Polls a running install/removal until it ends.
  useEffect(() => {
    if (!operation || operation.status !== 'running') return;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api().getPiPackageOperation(operation.id);
        setOperation(next);
        if (next.status === 'running') return;
        const name = next.source;
        if (next.status === 'succeeded') {
          toast.success(t(next.action === 'install' ? 'piPlugins.installed' : 'piPlugins.removed', { name }));
        } else {
          toast.danger(t(next.action === 'install' ? 'piPlugins.installFailed' : 'piPlugins.removeFailed', { name, message: next.error ?? '' }));
        }
        await load();
        changed.current();
      } catch (error) {
        setOperation({ ...operation, status: 'failed', error: errorText(error, t('piPlugins.readFailed')) });
      }
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [operation, api, load]);

  const startOperation = async (action: PiPackageOperation['action'], source: string) => {
    try {
      setOperation(await api().startPiPackageOperation(action, source));
      return true;
    } catch (error) {
      toast.danger(errorText(error, t('piPlugins.saveFailed')));
      return false;
    }
  };

  const openPage = async (config: PiPluginConfigId, title: string, summary?: string) => {
    setPage({ config, title, summary, draft: {} });
    try {
      const doc = await api().getPiPluginConfig(config);
      setPage((current) => (current?.config === config ? { ...current, doc, draft: doc.settings ?? {} } : current));
    } catch (error) {
      setPage((current) => (current?.config === config ? { ...current, loadError: errorText(error, t('piPlugins.readFailed')) } : current));
    }
  };

  const saved = page?.doc?.settings ?? null;
  const pageSpec = page ? PI_PLUGIN_PAGES[page.config] : undefined;
  /** The patch plus the rule maps it replaces whole, so their order is kept. */
  const pending = useMemo(() => {
    if (!page || !saved || !pageSpec) return { patch: {}, replace: [] as string[][] };
    let patch = mergePatch(saved, page.draft);
    const replace: string[][] = [];
    for (const field of pageSpec.groups.flatMap((group) => group.fields)) {
      if (field.kind !== 'rules') continue;
      const next = getAt(page.draft, field.path);
      if (next === undefined || JSON.stringify(next) === JSON.stringify(getAt(saved, field.path))) continue;
      patch = setAt(patch, field.path, next);
      replace.push(field.path);
    }
    return { patch, replace };
  }, [page, saved, pageSpec]);
  const dirty = Object.keys(pending.patch).length > 0;

  const save = async () => {
    if (!page?.doc || !pageSpec || !dirty) return;
    setSaving(true);
    const required = Object.fromEntries(Object.entries(pageSpec.required ?? {}).filter(([name, value]) => saved?.[name] !== value));
    const patch = { ...pending.patch, ...required };
    try {
      const doc = await api().patchPiPluginConfig(page.config, page.doc.revision, patch, pending.replace);
      setPage({ ...page, doc, draft: doc.settings ?? {} });
      toast.success(t('piPlugins.pageSaved', { name: page.title }));
    } catch (error) {
      if (!isConflictError(error)) {
        toast.danger(errorText(error, t('piPlugins.saveFailed')));
        return;
      }
      // Changed elsewhere: reload and replay the edits on top for review.
      try {
        const latest = await api().getPiPluginConfig(page.config);
        const draft = latest.settings ? applyMergePatch(latest.settings, patch) : {};
        setPage({ ...page, doc: latest, draft: pending.replace.reduce((next, path) => setAt(next, path, getAt(page.draft, path)), draft) });
        toast.warning(t('piPlugins.conflict'));
      } catch (reloadError) {
        toast.danger(errorText(reloadError, t('piPlugins.readFailed')));
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
    toggle,
    operation,
    startOperation,
    page,
    openPage,
    closePage: () => setPage(null),
    setDraft: (update: (draft: SettingsObject) => SettingsObject) => setPage((current) => (current ? { ...current, draft: update(current.draft) } : current)),
    templates,
    dirty: dirty || templates.dirty,
    saving: editingTemplate ? templates.saving : saving,
    canSave: editingTemplate ? templates.canSave : Boolean(page?.doc?.settings) && dirty && !saving,
    save: editingTemplate ? templates.save : save,
  };
}

export type PiPluginsState = ReturnType<typeof usePiPlugins>;

const RPC_CHIP: Record<PiRpcSupport, 'lime' | 'yellow' | 'neutral'> = {
  full: 'lime',
  partial: 'yellow',
  terminal: 'neutral',
  unknown: 'neutral',
};

export function PiPluginsPanel({ state }: { state: PiPluginsState }) {
  const t = useT();
  const { list, loadError, page } = state;
  const [installSource, setInstallSource] = useState('');
  const [confirm, setConfirm] = useState<{ action: PiPackageOperation['action']; source: string } | null>(null);
  const running = state.operation?.status === 'running';

  if (page && state.templates.editor) return <PiSubagentTemplateEditor state={state.templates} />;
  if (page) return <PluginPage state={state} page={page} />;
  if (loadError) {
    return (
      <Alert
        status="danger"
        title={t('piPlugins.readFailed')}
        description={loadError}
        actions={<Button size="small" variant="secondary" onClick={() => void state.load()}>{t('cliSettings.retry')}</Button>}
      />
    );
  }
  if (!list) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('piPlugins.reading')} /></div>;
  }

  const byCategory = new Map<PiPluginCategory, PiPackage[]>();
  for (const pkg of list.packages) {
    const category = knownPiPlugin(pkg)?.category ?? 'other';
    byCategory.set(category, [...(byCategory.get(category) ?? []), pkg]);
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="px-3 text-body-2-regular text-text-secondary">{t('piPlugins.intro', { count: list.packages.length })}</p>
      {list.parseError ? <Alert status="warning" title={t('piPlugins.parseError')} description={list.parseError} /> : null}
      {list.listError ? <Alert status="neutral" title={t('piPlugins.listError')} description={list.listError} /> : null}
      {running && state.operation ? (
        <Alert
          status="info"
          icon={SpinnerIcon}
          title={t(state.operation.action === 'install' ? 'piPlugins.installing' : 'piPlugins.removing', { name: state.operation.source })}
        />
      ) : null}
      {list.packages.length === 0 ? <p className="px-3 text-body-regular text-text-secondary">{t('piPlugins.empty')}</p> : null}
      {PI_PLUGIN_CATEGORIES.filter((category) => byCategory.has(category)).map((category) => (
        <SettingsGroup key={category} label={t(key(`piPlugins.category.${category}`))}>
          <SettingsCard>
            {byCategory.get(category)!.map((pkg) => (
              <PackageRow
                key={pkg.source}
                pkg={pkg}
                state={state}
                busy={running}
                onRemove={() => setConfirm({ action: 'remove', source: pkg.source })}
              />
            ))}
          </SettingsCard>
        </SettingsGroup>
      ))}
      <SettingsGroup label={t('piPlugins.builtins')} description={t('piPlugins.builtinsHint')}>
        <SettingsCard>
          {list.builtins.map((builtin) => (
            <SettingsRow
              key={builtin.id}
              label={t(key(`piPlugins.builtin.${builtin.id}`))}
              description={<span className="font-mono" dir="ltr">builtin:{builtin.id}</span>}
            >
              <Switch
                size="sm"
                aria-label={t('piPlugins.enable', { name: builtin.id })}
                isSelected={builtin.enabled}
                isDisabled={Boolean(state.toggling) || running}
                onChange={(enabled) => void state.toggle({ builtin: builtin.id }, enabled)}
              />
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsGroup>
      <SettingsGroup label={t('piPlugins.install')} description={t('piPlugins.installHint')}>
        <SettingsCard>
          <div className="flex items-center gap-2 py-2.5 pe-2.5">
            <Input
              aria-label={t('piPlugins.installSource')}
              size="small"
              className="min-w-0 flex-1"
              inputDir="ltr"
              placeholder="npm:pi-example"
              value={installSource}
              onChange={setInstallSource}
              inputClassName="font-mono"
            />
            <Button
              size="small"
              variant="secondary"
              leadingIcon={RiAddLine}
              disabled={!installSource.trim() || running}
              onClick={() => setConfirm({ action: 'install', source: installSource.trim() })}
            >
              {t('piPlugins.installAction')}
            </Button>
          </div>
        </SettingsCard>
      </SettingsGroup>
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={t(confirm?.action === 'remove' ? 'piPlugins.removeTitle' : 'piPlugins.installTitle')}
        description={confirm ? t(confirm.action === 'remove' ? 'piPlugins.removeBody' : 'piPlugins.installBody', { name: confirm.source }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={t(confirm?.action === 'remove' ? 'piPlugins.removeAction' : 'piPlugins.installAction')}
        tone={confirm?.action === 'remove' ? 'danger' : 'default'}
        onConfirm={async () => {
          if (!confirm) return;
          const started = await state.startOperation(confirm.action, confirm.source);
          if (started && confirm.action === 'install') setInstallSource('');
          setConfirm(null);
        }}
      />
    </div>
  );
}

function PackageRow({ pkg, state, busy, onRemove }: { pkg: PiPackage; state: PiPluginsState; busy: boolean; onRemove: () => void }) {
  const t = useT();
  const known = knownPiPlugin(pkg);
  const name = piPackageName(pkg) ?? pkg.source;
  const summary = known ? t(key(`piPlugins.summary.${known.slug}`)) : pkg.description;
  const rpc = known?.rpc ?? 'unknown';
  const config = known?.config;
  return (
    <SettingsRow
      label={(
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-mono text-body-2-medium" dir="ltr" title={pkg.source}>{name}</span>
          {pkg.version ? <span className="shrink-0 text-caption-1-regular text-text-tertiary" dir="ltr">{pkg.version}</span> : null}
        </span>
      )}
      description={summary}
    >
      {pkg.state === 'filtered' ? <Chip variant="caption" color="blue">{t('piPlugins.filtered')}</Chip> : null}
      {!pkg.installedPath ? <Chip variant="caption" color="orange">{t('piPlugins.notInstalled')}</Chip> : null}
      <Chip variant="caption" color={RPC_CHIP[rpc]}>{t(key(`piPlugins.rpc.${rpc}`))}</Chip>
      {config ? (
        <IconAction icon={RiSettings3Line} size="sm" tooltip={t('piPlugins.settings')} aria-label={t('piPlugins.settingsOf', { name })}
          onClick={() => void state.openPage(config, name, summary)} />
      ) : <span className="size-7" aria-hidden />}
      <IconAction icon={RiDeleteBin6Line} size="sm" tooltip={t('piPlugins.removeAction')} aria-label={t('piPlugins.removeOf', { name })} disabled={busy} onClick={onRemove} />
      <Switch
        size="sm"
        aria-label={t('piPlugins.enable', { name })}
        isSelected={pkg.state !== 'disabled'}
        isDisabled={pkg.state === 'filtered' || Boolean(state.toggling) || busy}
        onChange={(enabled) => void state.toggle({ source: pkg.source }, enabled)}
      />
    </SettingsRow>
  );
}

function PluginPage({ state, page }: { state: PiPluginsState; page: Page }) {
  const t = useT();
  const spec = PI_PLUGIN_PAGES[page.config];
  const prefix = `piPlugins.${page.config}`;
  return (
    <SettingsSubpage
      title={<span className="font-mono" dir="ltr">{page.title}</span>}
      description={page.summary}
      onBack={() => {
        if (state.dirty) toast.warning(t('piPlugins.discarded'));
        state.closePage();
      }}
    >
      {page.loadError ? (
        <Alert
          status="danger"
          title={t('piPlugins.readFailed')}
          description={page.loadError}
          actions={<Button size="small" variant="secondary" onClick={() => void state.openPage(page.config, page.title, page.summary)}>{t('cliSettings.retry')}</Button>}
        />
      ) : !page.doc ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('piPlugins.reading')} /></div>
      ) : (
        <>
          <p className="truncate px-3 font-mono text-caption-1-regular text-text-tertiary" dir="ltr" title={page.doc.path}>{page.doc.path}</p>
          {page.doc.parseError ? <Alert status="warning" title={t('piPlugins.pageParseError')} description={page.doc.parseError} /> : null}
          {!page.doc.exists ? <Alert status="neutral" title={t('piPlugins.pageMissing')} /> : null}
          {page.config === 'mcp-adapter' ? <Alert status="neutral" title={t('piPlugins.mcp-adapter.serversHint')} /> : null}
          {page.doc.settings ? spec.groups.map((group) => (
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
          )) : null}
          <p className="px-3 text-body-2-regular text-text-secondary">{t('piPlugins.pageApplies')}</p>
          {page.config === 'subagents' ? <PiSubagentTemplatesSection state={state.templates} /> : null}
        </>
      )}
    </SettingsSubpage>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RiAddLine, RiDeleteBin6Line, RiEyeLine, RiEyeOffLine } from '@remixicon/react';
import type { CliSettingsDocument, CliSettingsProvider, V2ApiClient } from '@todex/protocol/v2';
import { isConflictError } from '@todex/protocol/connectionError';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Tab, TabList, TabPanel, Tabs } from '@/components/base/tabs/tabs';
import { Textarea } from '@/components/base/textarea/textarea';
import { Alert } from '@/components/ui/alert';
import { IconAction } from '@/components/ui/icon-action';
import { Modal } from '@/components/ui/modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { SettingsCard, SettingsGroup, SETTINGS_ROW } from '@/components/settings/SettingsRows';
import { useT, type MessageKey } from '@/i18n';
import { cx } from '@/utils/cx';
import {
  CLI_SETTINGS,
  ENV_NAME,
  applyMergePatch,
  envFromRows,
  envRows,
  fieldId,
  getAt,
  mergePatch,
  setAt,
  type CliSettingsSchema,
  type SettingsObject,
} from '@/lib/cliSettings';
import { CliInstructionsPanel, useCliInstructions } from './CliInstructionsTab';
import { DshPluginsPanel, useDshPlugins } from './DshPluginsTab';
import { PiMcpPanel, usePiMcp } from './PiMcpTab';
import { PiPluginsPanel, usePiPlugins } from './PiPluginsTab';
import { SettingsField, SettingsFieldModels } from './SettingsFields';

type TabId = 'form' | 'env' | 'plugins' | 'mcp' | 'raw' | 'agents';
const TAB_IDS: TabId[] = ['form', 'env', 'plugins', 'mcp', 'raw', 'agents'];
type EnvRow = { key: number; name: string; value: string; revealed: boolean };

const key = (value: string) => value as MessageKey;

/** A CLI's user settings file on the backend host; open while `provider` is set. */
export function CliSettingsModal({ provider, onClose, api }: {
  provider: CliSettingsProvider | null;
  onClose: () => void;
  api: () => V2ApiClient;
}) {
  const t = useT();
  // Keeps the last schema while the modal animates out.
  const lastProvider = useRef<CliSettingsProvider>('claude-code');
  if (provider) lastProvider.current = provider;
  const schema = CLI_SETTINGS[lastProvider.current];
  return (
    <Modal
      isOpen={provider !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('cliSettings.title', { name: schema.name })}
      size="2xl"
      className="h-[min(760px,calc(100dvh-32px))]"
      isDismissable={false}
      bodyClassName="flex flex-col overflow-hidden pb-0"
    >
      {provider ? <CliSettingsEditor key={provider} schema={schema} api={api} onClose={onClose} /> : null}
    </Modal>
  );
}

function CliSettingsEditor({ schema, api, onClose }: { schema: CliSettingsSchema; api: () => V2ApiClient; onClose: () => void }) {
  const { provider, envPath } = schema;
  const t = useT();
  const [doc, setDoc] = useState<CliSettingsDocument>();
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState<SettingsObject>({});
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [rawText, setRawText] = useState('');
  const [rawRevealed, setRawRevealed] = useState(false);
  const hasForm = schema.groups.length > 0;
  const [tab, setTab] = useState<TabId>(hasForm ? 'form' : 'plugins');
  const [saving, setSaving] = useState(false);
  const nextEnvKey = useRef(0);
  const instructions = useCliInstructions(provider, api);
  const isPi = provider === 'pi';
  const isDsh = provider === 'deepseek-harness';

  const toEnvRows = (settings: SettingsObject) => (envPath ? envRows(settings, envPath) : []).map((row) => ({ ...row, key: nextEnvKey.current++, revealed: false }));

  /** Takes in a document; `draft` replaces the form state (default: the saved settings). */
  const adopt = useCallback((next: CliSettingsDocument, draftSettings?: SettingsObject) => {
    setDoc(next);
    const settings = draftSettings ?? next.settings ?? {};
    setDraft(settings);
    setEnv(toEnvRows(settings));
    setRawText(next.text);
    if (!next.settings) setTab('raw');
    else if (!hasForm) setTab((current) => (current === 'form' ? 'plugins' : current));
  }, []);

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      adopt(await api().getCliSettings(provider));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('cliSettings.readFailed'));
    }
  }, [adopt, api, provider]);

  useEffect(() => { void load(); }, [load]);

  const saved = doc?.settings ?? null;
  // The form and the env tab edit one draft; env rows are folded in on save.
  const formNext = useMemo(() => (envPath ? setAt(draft, envPath, envFromRows(env)) : draft), [draft, env, envPath]);
  const patch = useMemo(() => (saved ? mergePatch(saved, formNext) : {}), [saved, formNext]);
  const formDirty = Object.keys(patch).length > 0;
  const rawDirty = Boolean(doc) && rawText !== doc?.text;
  // Plugin switches rewrite settings.json: take the new revision in when
  // nothing here is being edited, else saving reports the conflict.
  const pristine = useRef(true);
  pristine.current = !formDirty && !rawDirty;
  const piPlugins = usePiPlugins(isPi, api, () => { if (pristine.current) void load(); });
  const dshPlugins = useDshPlugins(isDsh, api, () => { if (pristine.current) void load(); });
  // The Plugins tab's state (save, unsaved edits) for whichever CLI has one.
  const plugins = isDsh ? dshPlugins : piPlugins;
  const mcp = usePiMcp(isPi && tab === 'mcp', api);
  // Models the plugin pages offer: the ones enabled in Pi, without patterns.
  const piModels = useMemo(() => {
    if (!isPi) return [];
    const enabled = getAt(draft, ['enabledModels']);
    const models = Array.isArray(enabled) ? enabled.filter((item): item is string => typeof item === 'string' && !item.includes('*')) : [];
    const provider = getAt(draft, ['defaultProvider']);
    const model = getAt(draft, ['defaultModel']);
    if (typeof provider === 'string' && typeof model === 'string') models.unshift(`${provider}/${model}`);
    return [...new Set(models)];
  }, [draft, isPi]);
  // TOML and YAML are checked by the backend on save.
  const rawError = useMemo(() => (doc?.format === 'json' ? rawObjectError(rawText) : null), [doc?.format, rawText]);
  const fileName = doc?.path.split(/[\\/]/).pop() || doc?.path || '';
  const envInvalid = env.some((row) => row.name.trim() !== '' && !ENV_NAME.test(row.name.trim()));
  const editingRaw = tab === 'raw';
  const editingAgents = tab === 'agents';
  const editingPlugins = tab === 'plugins';
  // MCP changes are written as they are made.
  const editingMcp = tab === 'mcp';
  const canSave = editingMcp ? false : editingAgents
    ? instructions.canSave
    : editingPlugins
      ? plugins.canSave
      : Boolean(doc) && !saving && (editingRaw ? rawDirty && !rawError : formDirty && !envInvalid);
  // Edits left unsaved on a tab other than the one shown.
  const unsavedElsewhere = editingAgents || editingPlugins || editingMcp
    ? (formDirty || rawDirty) ? 'cliSettings.settingsUnsaved'
      : !editingAgents && instructions.dirty ? 'cliSettings.agentsUnsaved'
        : !editingPlugins && plugins.dirty && 'cliSettings.pluginsUnsaved'
    : (editingRaw ? formDirty : rawDirty) ? (editingRaw ? 'cliSettings.formUnsaved' : 'cliSettings.rawUnsaved')
      : instructions.dirty ? 'cliSettings.agentsUnsaved' : plugins.dirty && 'cliSettings.pluginsUnsaved';

  const save = async () => {
    if (editingAgents) {
      await instructions.save();
      return;
    }
    if (editingPlugins) {
      await plugins.save();
      return;
    }
    if (!doc) return;
    setSaving(true);
    try {
      const next = editingRaw
        ? await api().replaceCliSettings(provider, doc.revision, rawText)
        : await api().patchCliSettings(provider, doc.revision, patch);
      adopt(next);
      toast.success(t('cliSettings.saved', { name: schema.name }));
    } catch (error) {
      if (!isConflictError(error)) {
        toast.danger(error instanceof Error ? error.message : t('cliSettings.saveFailed'));
        return;
      }
      // Someone else wrote the file: reload it and replay the form edits on
      // top (the raw text is kept as typed), so nothing is lost or silently
      // overwritten; the user reviews and saves again.
      try {
        const latest = await api().getCliSettings(provider);
        if (editingRaw) {
          setDoc(latest);
        } else {
          adopt(latest, latest.settings ? applyMergePatch(latest.settings, patch) : undefined);
        }
        toast.warning(t('cliSettings.conflict'));
      } catch (reloadError) {
        toast.danger(reloadError instanceof Error ? reloadError.message : t('cliSettings.readFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <Alert
        status="danger"
        title={t('cliSettings.readFailed')}
        description={loadError}
        actions={<Button size="small" variant="secondary" onClick={() => void load()}>{t('cliSettings.retry')}</Button>}
      />
    );
  }
  if (!doc) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('cliSettings.reading')} /></div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* The AGENTS.md tab names its own file. */}
      <p className={cx('truncate text-body-2-regular text-text-secondary', editingAgents && 'invisible')} dir="ltr" title={doc.path}>{doc.path}</p>
      <Tabs selectedKey={tab} onSelectionChange={(next) => setTab(TAB_IDS.find((id) => id === next) ?? 'form')} className="min-h-0 flex-1 gap-0">
        <TabList aria-label={t('cliSettings.tabsLabel')}>
          {hasForm ? <Tab id="form" isDisabled={!saved}>{t('cliSettings.tabForm')}</Tab> : null}
          {envPath ? <Tab id="env" isDisabled={!saved} count={env.length || undefined}>{t('cliSettings.tabEnv')}</Tab> : null}
          {isPi ? <Tab id="plugins" count={piPlugins.list?.packages.length || undefined}>{t('cliSettings.tabPlugins')}</Tab> : null}
          {isDsh ? <Tab id="plugins" count={dshPlugins.list?.packages.length || undefined}>{t('cliSettings.tabPlugins')}</Tab> : null}
          {isPi ? <Tab id="mcp" count={Object.keys(mcp.doc?.config?.mcpServers ?? {}).length || undefined}>MCP</Tab> : null}
          <Tab id="raw">{t('cliSettings.tabRaw')}</Tab>
          <Tab id="agents">AGENTS.md</Tab>
        </TabList>
        <ScrollArea surface="full" className="-mx-6 flex-1" contentClassName="px-6 pt-4 pb-4">
          {hasForm ? <TabPanel id="form" className="flex flex-col gap-5">
            <p className="px-3 text-body-2-regular text-text-secondary">
              {doc.exists ? t(schema.hints.scope) : t('cliSettings.missingHint')}
            </p>
            {schema.groups.map((group) => (
              <SettingsGroup key={group.id} label={t(key(`${schema.keyPrefix}.group.${group.id}`))}>
                <SettingsCard>
                  {group.fields.map((field) => (
                    <SettingsField
                      key={fieldId(field.path)}
                      field={field}
                      keyPrefix={schema.keyPrefix}
                      value={getAt(draft, field.path)}
                      onChange={(value) => setDraft((current) => setAt(current, field.path, value))}
                    />
                  ))}
                </SettingsCard>
              </SettingsGroup>
            ))}
            <p className="px-3 text-body-2-regular text-text-secondary">{t(schema.hints.moreInRaw)}</p>
          </TabPanel> : null}
          {envPath ? (
            <TabPanel id="env" className="flex flex-col gap-3">
              {schema.hints.env ? <p className="px-3 text-body-2-regular text-text-secondary">{t(schema.hints.env)}</p> : null}
              <EnvEditor rows={env} onChange={setEnv} nextKey={() => nextEnvKey.current++} />
            </TabPanel>
          ) : null}
          {isPi ? (
            <TabPanel id="plugins">
              <SettingsFieldModels.Provider value={piModels}>
                <PiPluginsPanel state={piPlugins} />
              </SettingsFieldModels.Provider>
            </TabPanel>
          ) : null}
          {isPi ? (
            <TabPanel id="mcp">
              <PiMcpPanel
                state={mcp}
                builtinBusy={Boolean(piPlugins.toggling)}
                onEnableBuiltin={async () => {
                  await piPlugins.toggle({ builtin: 'mcp' }, true);
                  await mcp.load();
                }}
              />
            </TabPanel>
          ) : null}
          {isDsh ? (
            <TabPanel id="plugins" className="flex flex-col gap-3">
              {dshPlugins.page ? null : <p className="px-3 text-body-2-regular text-text-secondary">{t(schema.hints.scope)}</p>}
              <DshPluginsPanel state={dshPlugins} />
            </TabPanel>
          ) : null}
          <TabPanel id="raw" className="flex flex-col gap-3">
            {doc.parseError ? <Alert status="warning" title={t('cliSettings.parseError', { file: fileName })} description={doc.parseError} /> : null}
            {rawRevealed || !doc.exists ? (
              <Textarea
                className="w-full"
                aria-label={fileName}
                value={rawText}
                onChange={setRawText}
                rows={22}
                spellCheck="false"
                isInvalid={Boolean(rawError)}
                hint={rawError ?? t(doc.format === 'toml' ? 'cliSettings.rawHintToml' : doc.format === 'yaml' ? 'cliSettings.rawHintYaml' : 'cliSettings.rawHintJson')}
                inputClassName="font-mono text-caption-1-regular"
              />
            ) : (
              <Alert
                status="neutral"
                title={t('cliSettings.rawHiddenTitle')}
                description={t(schema.hints.rawHidden)}
                actions={<Button size="small" variant="secondary" leadingIcon={RiEyeLine} onClick={() => setRawRevealed(true)}>{t('cliSettings.reveal')}</Button>}
              />
            )}
          </TabPanel>
          <TabPanel id="agents">
            <CliInstructionsPanel state={instructions} />
          </TabPanel>
        </ScrollArea>
      </Tabs>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-separator-border pt-4 pb-6">
        {unsavedElsewhere ? (
          <span className="me-auto text-body-2-regular text-text-secondary">{t(unsavedElsewhere)}</span>
        ) : null}
        <Button variant="secondary" onClick={onClose} disabled={saving || instructions.busy || plugins.saving || mcp.busy}>{t('common.close')}</Button>
        <Button onClick={() => void save()} disabled={!canSave} aria-busy={(editingAgents ? instructions.busy : editingPlugins ? plugins.saving : saving) || undefined}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

function rawObjectError(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? null : 'settings.json must contain a JSON object';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function EnvEditor({ rows, onChange, nextKey }: { rows: EnvRow[]; onChange: (rows: EnvRow[]) => void; nextKey: () => number }) {
  const t = useT();
  const update = (rowKey: number, changes: Partial<EnvRow>) => onChange(rows.map((row) => (row.key === rowKey ? { ...row, ...changes } : row)));
  return (
    <SettingsCard>
      {rows.map((row) => {
        const invalid = row.name.trim() !== '' && !ENV_NAME.test(row.name.trim());
        return (
          <div key={row.key} className={cx(SETTINGS_ROW, 'flex items-start gap-2')}>
            <Input
              aria-label={t('cliSettings.envName')}
              size="small"
              className="w-56 shrink-0"
              inputDir="ltr"
              placeholder="NAME"
              value={row.name}
              isInvalid={invalid}
              hint={invalid ? t('cliSettings.envNameInvalid') : undefined}
              onChange={(name) => update(row.key, { name })}
              inputClassName="font-mono"
            />
            <Input
              aria-label={t('cliSettings.envValue', { name: row.name })}
              size="small"
              className="min-w-0 flex-1"
              inputDir="ltr"
              type={row.revealed ? 'text' : 'password'}
              autoComplete="off"
              value={row.value}
              onChange={(value) => update(row.key, { value })}
              inputClassName="font-mono"
            />
            <IconAction
              icon={row.revealed ? RiEyeOffLine : RiEyeLine}
              size="md"
              aria-label={t(row.revealed ? 'cliSettings.hideValue' : 'cliSettings.showValue')}
              onClick={() => update(row.key, { revealed: !row.revealed })}
            />
            <IconAction
              icon={RiDeleteBin6Line}
              size="md"
              aria-label={t('cliSettings.removeEnv', { name: row.name })}
              onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
            />
          </div>
        );
      })}
      <div className={SETTINGS_ROW}>
        <Button size="small" variant="ghost" leadingIcon={RiAddLine} onClick={() => onChange([...rows, { key: nextKey(), name: '', value: '', revealed: true }])}>
          {t('cliSettings.addEnv')}
        </Button>
      </div>
    </SettingsCard>
  );
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button as AriaButton,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
} from 'react-aria-components';
import { RiAddLine, RiArrowDownSLine, RiCheckLine, RiCloseLine, RiDeleteBinLine, RiDownload2Line, RiEdit2Line, RiRefreshLine, RiUpload2Line, RiUserSettingsLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/base/buttons/button-group';
import { MENU_ITEM, MENU_ITEM_ACTIVE, MENU_ITEMS_CONTAINER, MENU_POPOVER_SURFACE } from '@/components/base/dropdown/menu-styles';
import { Input } from '@/components/base/input/input';
import { Label } from '@/components/base/input/label';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { PillTab, PillTabList } from '@/components/base/tabs/pill-tab';
import { Textarea } from '@/components/base/textarea/textarea';
import { ChevronDownSmall } from '@/components/foundations/icons/chevrons';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { ComboBox, ComboBoxItem } from '@/components/ui/combo-box';
import { IconAction } from '@/components/ui/icon-action';
import { Spinner, SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import {
  AGENT_PROVIDER_TRANSFER_FORMAT,
  MANAGED_PROVIDER_AGENTS,
  PROVIDER_DISPLAY_NAMES,
  type AgentProviderBucket,
  type AgentProviderProfile,
  type AgentProviderTransfer,
  type AgentProvidersResponse,
  type ManagedProviderAgent,
} from '@todex/protocol/v2';
import { ConnectionError } from '@todex/protocol/connectionError';
import { ProviderIcon } from '../components/ProviderIcon';
import { Field } from '../components/Field';
import {
  asRecord,
  buildSettingsConfig,
  defaultEfforts,
  DSH_API_KINDS,
  DSH_DEEPSEEK_ROUTE,
  emptyModelEntry,
  extractFormValues,
  GROK_API_BACKENDS,
  isAdditiveAgent,
  modelIdsFromText,
  providerBaseUrl,
  providerModelIds,
  thinkingLevelsFor,
  validateModelForm,
  type ModelFormEntry,
  type ProviderConfigSource,
  type ProviderFormValues,
} from '../lib/agentProviders';
import { useT } from '../i18n';
import type { TodeXSession } from '../session/useTodeXSession';
import { usePanelBackend } from '../session/panelBackend';
import { BackendSelect } from '@/components/ui/backend-select';
import { backendApi } from '../session/helpers';

type EditorState =
  | { kind: 'new' }
  | { kind: 'edit'; profile: AgentProviderProfile }
  | { kind: 'adopt'; nodeId: string }
  | null;

/// `api` values pi supports in models.json (built-in APIs plus gateway
/// protocols); extension-registered customs stay possible via JSON mode.
const PI_API_KINDS = [
  'openai-completions',
  'openai-responses',
  'azure-openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-vertex',
  'mistral-conversations',
  'bedrock-converse-stream',
  'pi-messages',
];

export function AgentProvidersPanel({ session }: { session: TodeXSession }) {
  const t = useT();
  const [agent, setAgent] = useState<ManagedProviderAgent>('codex');
  const [agents, setAgents] = useState<AgentProvidersResponse['agents']>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [editor, setEditor] = useState<EditorState>(null);
  const requestGeneration = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const backend = usePanelBackend(session);
  const { settings } = backend;
  const api = useCallback(() => backendApi(settings), [settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl]);

  // Another backend's agents replace this one's, not merge into them.
  useEffect(() => {
    setAgents({});
    setEditor(null);
  }, [backend.backendId]);

  const refresh = useCallback(async (quiet = false) => {
    const generation = ++requestGeneration.current;
    if (!quiet) setLoading(true);
    try {
      const response = await api().listAgentProviders();
      if (generation !== requestGeneration.current) return;
      setAgents(response.agents);
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      if (!quiet) toast.danger(error instanceof Error ? error.message : t('ap.readFailed'));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

  // Only agents installed on the backend's machine; until the provider list
  // arrives every managed agent stays listed so the panel is never empty.
  const installedAgents = useMemo(() => {
    const { providers } = backend;
    if (!providers.length) return MANAGED_PROVIDER_AGENTS;
    return MANAGED_PROVIDER_AGENTS.filter((id) => providers.some((item) => item.id === id && item.available));
  }, [backend.providers]);

  // A selected agent that is not installed falls back to the first one that is.
  useEffect(() => {
    if (installedAgents.length && !installedAgents.includes(agent)) {
      setAgent(installedAgents[0]);
      setEditor(null);
    }
  }, [agent, installedAgents]);

  const bucket: AgentProviderBucket | undefined = agents[agent];

  const applyBucket = (next: AgentProviderBucket) => {
    setAgents((current) => ({ ...current, [next.agent as ManagedProviderAgent]: next }));
  };

  const run = async (key: string, action: () => Promise<AgentProviderBucket | void>, successKey?: Parameters<typeof t>[0]) => {
    setBusy(key);
    try {
      const next = await action();
      if (next) applyBucket(next);
      if (successKey) toast.success(t(successKey));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('ap.failed'));
    } finally {
      setBusy(undefined);
    }
  };

  const activate = (profile: AgentProviderProfile) => {
    void run(`activate:${profile.id}`,
      () => api().activateAgentProvider(agent, profile.id), 'ap.activated');
  };

  const remove = (profile: AgentProviderProfile) => {
    void run(`delete:${profile.id}`, async () => {
      await api().deleteAgentProvider(agent, profile.id);
      await refresh(true);
    }, 'ap.deleted');
  };

  /// The file carries every secret in clear so another backend can use it;
  /// the toast says so because nothing else in the panel shows raw keys.
  const exportProviders = () => {
    void run('export', async () => {
      const transfer = await api().exportAgentProviders(agent);
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      downloadJson(`todex-${agent}-providers-${stamp}.json`, transfer);
    }, 'ap.exported');
  };

  const importProviders = async (file: File) => {
    let transfer: AgentProviderTransfer;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AgentProviderTransfer> | null;
      if (parsed?.format !== AGENT_PROVIDER_TRANSFER_FORMAT || !Array.isArray(parsed.providers)) {
        toast.danger(t('ap.importInvalid'));
        return;
      }
      if (parsed.agent !== agent) {
        toast.danger(t('ap.importWrongAgent', { agent: PROVIDER_DISPLAY_NAMES[parsed.agent as ManagedProviderAgent] ?? String(parsed.agent) }));
        return;
      }
      transfer = parsed as AgentProviderTransfer;
    } catch {
      toast.danger(t('ap.importInvalid'));
      return;
    }
    setEditor(null);
    await run('import', async () => {
      const next = await api().importAgentProviders(agent, transfer);
      toast.success(t('ap.importedCount', { count: transfer.providers.length }));
      return next;
    });
  };

  const activeBackend = backend.profile;
  const additiveAgent = isAdditiveAgent(agent);
  const additive = bucket?.mode === 'additive';
  const live = bucket?.live;
  const liveSelection = live?.kind === 'additive' ? live.selection : null;
  const unmanaged = live?.kind === 'additive' ? live.unmanagedProviders : [];
  const unmanagedNodes = live?.kind === 'additive' ? live.providers : {};
  const liveMismatch = live?.kind === 'exclusive' && live.configured && !live.matchesCurrent;

  /// The editor mounts inline under the card it edits (or at the bottom for
  /// 'new'); the key remounts it when the target changes so form state resets.
  const renderEditor = () => editor ? (
    <ProviderEditor
      key={editor.kind === 'edit' ? editor.profile.id : editor.kind === 'adopt' ? `adopt:${editor.nodeId}` : 'new'}
      settings={settings}
      agent={agent}
      editor={editor}
      unmanagedNodes={unmanagedNodes}
      busy={Boolean(busy)}
      onCancel={() => setEditor(null)}
      onSave={(id, input) => void run('save', async () => {
        if (editor.kind === 'adopt') {
          try {
            await api().importLiveAgentProvider(agent, id, input.name);
          } catch (error) {
            const details = error instanceof ConnectionError ? error.technicalDetails : '';
            if (!details.includes('CONFLICT') && !details.includes('HTTP 409')) throw error;
          }
        }
        const next = await api().upsertAgentProvider(agent, id, input);
        setEditor(null);
        return next;
      }, 'ap.saved')}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2lg bg-badge-new-background text-badge-new-text">
          <RiUserSettingsLine aria-hidden className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-headline-semibold text-text-primary">{activeBackend?.name || t('cli.currentBackend')}</h2>
          <p className="truncate text-caption-1-regular text-text-secondary" title={settings.serverUrl}>{settings.serverUrl}</p>
        </div>
        <BackendSelect profiles={session.backendConnections} linkStates={session.backendLinkStatus} selectedId={backend.backendId} onChange={backend.setBackendId} />
        <IconAction icon={RiRefreshLine} size="md" aria-label={t('ap.refresh')} disabled={loading} onClick={() => void refresh()} />
      </div>

      <p className="-mt-2 text-caption-1-regular text-text-secondary">{t(additiveAgent ? 'ap.globalNoteAdditive' : 'ap.globalNote')}</p>

      <PillTabList className="flex-wrap">
        {installedAgents.map((id) => (
          <PillTab key={id} variant="gray" isSelected={agent === id} onSelect={() => { setAgent(id); setEditor(null); }}>
            <span className="inline-flex items-center gap-1.5">
              <ProviderIcon provider={id} className="size-4" />
              {PROVIDER_DISPLAY_NAMES[id]}
            </span>
          </PillTab>
        ))}
      </PillTabList>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('cli.reading')} /></div>
      ) : !installedAgents.length ? (
        <p className="py-10 text-center text-body-regular text-text-secondary">{t('ap.noInstalledAgents')}</p>
      ) : !bucket ? (
        <p className="py-10 text-center text-body-regular text-text-secondary">{t('ap.unsupported')}</p>
      ) : (
        <>
          {liveMismatch ? (
            <Alert
              status="warning"
              description={t('ap.liveMismatch')}
              actions={(
                <Button size="small" variant="secondary" disabled={Boolean(busy)}
                  onClick={() => void run('import-live', () => api().importLiveAgentProvider(agent, 'imported', t('ap.importedName')), 'ap.imported')}>
                  {t('ap.importLive')}
                </Button>
              )}
            />
          ) : null}

          <div className="grid gap-2">
            {bucket.providers.map((profile) => {
              const editingThis = editor?.kind === 'edit' && editor.profile.id === profile.id;
              const settings = profile.settingsConfig as Record<string, unknown>;
              const isCurrent = !additive && bucket.currentProviderId === profile.id;
              const isDefault = liveSelection?.providerId === profile.id;
              const defaultModelId = isDefault ? liveSelection?.modelId : null;
              const modelIds = providerModelIds(agent, settings);
              const activating = busy === `activate:${profile.id}`;
              return (
                <Fragment key={profile.id}>
                <Card variant="secondary" className="min-w-0 gap-0">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stat-card-icon-background">
                      <ProviderIcon className="size-5" provider={agent} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-body-semibold text-text-primary">{profile.name}</h3>
                        {isCurrent ? <Chip variant="caption" color="lime">{t('ap.active')}</Chip> : null}
                        {isDefault ? <Chip variant="caption" color="lime">{t('ap.default')}</Chip> : null}
                      </div>
                      <p className="mt-0.5 truncate text-caption-1-regular text-text-secondary">{providerBaseUrl(agent, settings) || profile.id}</p>
                      {additive && modelIds.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {modelIds.map((modelId) => (
                            <Chip key={modelId} variant="caption" color={modelId === defaultModelId ? 'lime' : 'neutral'}>
                              {modelId}
                            </Chip>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {agent === 'deepseek-harness' && !isDefault ? (
                        <Button size="small" variant="secondary" className="me-1" disabled={Boolean(busy)} aria-busy={activating || undefined}
                          leadingIcon={activating ? SpinnerIcon : RiCheckLine}
                          onClick={() => activate(profile)}>
                          {t('ap.setDefault')}
                        </Button>
                      ) : null}
                      {!additive && !isCurrent ? (
                        <Button size="small" variant="primary" className="me-1" disabled={Boolean(busy)} aria-busy={activating || undefined}
                          leadingIcon={activating ? SpinnerIcon : RiCheckLine}
                          onClick={() => activate(profile)}>
                          {t('ap.activate')}
                        </Button>
                      ) : null}
                      <IconAction icon={RiEdit2Line} size="sm" aria-label={t('ap.edit')}
                        onClick={() => setEditor({ kind: 'edit', profile })} />
                      <IconAction icon={RiDeleteBinLine} size="sm" aria-label={t('ap.delete')}
                        disabled={busy === `delete:${profile.id}`} onClick={() => remove(profile)} />
                    </div>
                  </div>
                </Card>
                {editingThis ? renderEditor() : null}
                </Fragment>
              );
            })}

            {unmanaged.map((nodeId) => {
              const nodeSettings = asRecord(unmanagedNodes[nodeId]);
              const nodeBaseUrl = providerBaseUrl(agent, nodeSettings);
              const nodeModels = providerModelIds(agent, nodeSettings);
              const isLiveSelection = liveSelection?.providerId === nodeId;
              const adoptingThis = editor?.kind === 'adopt' && editor.nodeId === nodeId;
              return (
                <Fragment key={nodeId}>
                <div className="min-w-0 rounded-2xl border border-dashed border-border-button-default bg-background-primary-default p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-body-semibold text-text-primary">{nodeId}</h3>
                        <Chip variant="caption" color="neutral">{t('ap.unmanaged')}</Chip>
                        {isLiveSelection ? <Chip variant="caption" color="lime">{t('ap.default')}</Chip> : null}
                      </div>
                      {nodeBaseUrl ? (
                        <p className="mt-0.5 truncate text-caption-1-regular text-text-secondary">{nodeBaseUrl}</p>
                      ) : null}
                      {nodeModels.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {nodeModels.map((modelId) => (
                            <Chip key={modelId} variant="caption"
                              color={isLiveSelection && liveSelection?.modelId === modelId ? 'lime' : 'neutral'}>
                              {modelId}
                            </Chip>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <Button size="small" variant="secondary" className="shrink-0" disabled={Boolean(busy)} onClick={() => setEditor({ kind: 'adopt', nodeId })}>
                      {t('ap.adopt')}
                    </Button>
                  </div>
                </div>
                {adoptingThis ? renderEditor() : null}
                </Fragment>
              );
            })}

            {bucket.providers.length === 0 && unmanaged.length === 0 ? (
              <p className="rounded-2xl bg-background-secondary-default px-6 py-8 text-center text-body-regular text-text-secondary">{t('ap.noProviders')}</p>
            ) : null}
          </div>

          {editor?.kind === 'new' ? renderEditor() : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" leadingIcon={RiAddLine} onClick={() => setEditor({ kind: 'new' })}>
                {t('ap.add')}
              </Button>
              <Button variant="secondary" disabled={Boolean(busy) || bucket.providers.length === 0}
                leadingIcon={busy === 'export' ? SpinnerIcon : RiDownload2Line} aria-busy={busy === 'export' || undefined}
                onClick={exportProviders}>
                {t('ap.export')}
              </Button>
              <Button variant="secondary" disabled={Boolean(busy)}
                leadingIcon={busy === 'import' ? SpinnerIcon : RiUpload2Line} aria-busy={busy === 'import' || undefined}
                onClick={() => importInput.current?.click()}>
                {t('ap.import')}
              </Button>
              <input
                ref={importInput}
                className="hidden"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset so picking the same file again still fires onChange.
                  event.target.value = '';
                  if (file) void importProviders(file);
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function downloadJson(fileName: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoke after the click has handed the blob to the download manager.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProviderEditor({
  settings,
  agent,
  editor,
  unmanagedNodes,
  busy,
  onCancel,
  onSave,
}: {
  /** Transport of the backend the panel acts on. */
  settings: Parameters<typeof backendApi>[0];
  agent: ManagedProviderAgent;
  editor: Exclude<EditorState, null>;
  unmanagedNodes: Record<string, unknown>;
  busy: boolean;
  onCancel: () => void;
  onSave: (id: string, input: { name: string; settingsConfig: Record<string, unknown> }) => void;
}) {
  const t = useT();
  const profile = editor.kind === 'edit' ? editor.profile : undefined;
  const adoptNode = editor.kind === 'adopt' ? asRecord(unmanagedNodes[editor.nodeId]) : undefined;
  const adoptName = editor.kind === 'adopt' && typeof adoptNode?.name === 'string' && adoptNode.name.trim()
    ? adoptNode.name.trim()
    : editor.kind === 'adopt' ? editor.nodeId : '';
  const baseSource: ProviderConfigSource | undefined = profile
    ?? (adoptNode ? { name: adoptName, settingsConfig: adoptNode } : undefined);
  const [form, setForm] = useState<ProviderFormValues>(() => {
    const values = extractFormValues(agent, baseSource);
    // A new dsh route starts as a custom one, which needs a protocol.
    return agent === 'deepseek-harness' && !baseSource ? { ...values, apiKind: DSH_API_KINDS[0] } : values;
  });
  const [formDirty, setFormDirty] = useState(false);
  const updateForm = (patch: Partial<ProviderFormValues>) => {
    setForm((current) => ({ ...current, ...patch }));
    setFormDirty(true);
  };
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(
    profile?.settingsConfig ?? adoptNode ?? {},
    null,
    2,
  ));
  const [id, setId] = useState(() => editor.kind === 'adopt' ? editor.nodeId : (profile?.id ?? ''));
  const [error, setError] = useState('');

  const idLocked = editor.kind !== 'new';
  const isClaude = agent === 'claude-code';
  const isCodex = agent === 'codex';
  const isGrok = agent === 'grok-build';
  const grokSubscription = isGrok && form.authMode === 'subscription';
  const isDsh = agent === 'deepseek-harness';
  // dsh's built-in DeepSeek route takes only a key and an endpoint.
  const dshDeepseek = isDsh && id.trim() === DSH_DEEPSEEK_ROUTE;
  const isAdditive = isAdditiveAgent(agent) && !dshDeepseek;

  const apiKindOptions =
    form.apiKind && !PI_API_KINDS.includes(form.apiKind)
      ? [...PI_API_KINDS, form.apiKind]
      : PI_API_KINDS;

  // The backend resolves masked secrets against the stored profile or the
  // live additive node of the same id, so this works pre-save in all modes.
  const fetchEditorModels = async () => {
    const client = backendApi(settings);
    const response = await client.previewAgentProviderModels(
      agent,
      id.trim() || 'preview',
      buildSettingsConfig(agent, form, baseSource),
    );
    return response.models;
  };

  const save = () => {
    const name = form.name.trim();
    const providerId = id.trim();
    if (!name || !providerId) {
      setError(t('ap.nameIdRequired'));
      return;
    }
    if (jsonMode) {
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        onSave(providerId, { name, settingsConfig: parsed as Record<string, unknown> });
      } catch {
        setError(t('ap.jsonInvalid'));
      }
      return;
    }
    const invalid = validateModelForm(agent, form, baseSource);
    if (invalid) {
      setError(t(invalid));
      return;
    }
    onSave(providerId, { name, settingsConfig: buildSettingsConfig(agent, form, baseSource) });
  };

  const switchToJson = () => {
    if (!jsonMode && (editor.kind === 'new' || formDirty)) {
      setJsonText(JSON.stringify(buildSettingsConfig(agent, form, baseSource), null, 2));
      setFormDirty(false);
    }
    setJsonMode(true);
  };

  return (
    <Card className="gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body-semibold text-text-primary">
          {editor.kind === 'new' ? t('ap.add') : editor.kind === 'adopt' ? t('ap.adopt') : t('ap.edit')}
        </h3>
        <SegmentedControl
          selectedKeys={[jsonMode ? 'json' : 'form']}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next === 'form') setJsonMode(false);
            else if (next === 'json') switchToJson();
          }}
        >
          <SegmentedControlItem id="form">{t('ap.formMode')}</SegmentedControlItem>
          <SegmentedControlItem id="json">{t('ap.jsonMode')}</SegmentedControlItem>
        </SegmentedControl>
      </div>

      {editor.kind === 'adopt' ? (
        <p className="text-caption-1-regular text-text-secondary">{t('ap.adoptParsed')}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('ap.name')} value={form.name} onChange={(name) => updateForm({ name })} />
        <Input className="w-full" label={t('ap.providerId')} placeholder="my-provider" value={id} onChange={setId} isDisabled={idLocked} />
      </div>

      {jsonMode ? (
        <Textarea
          className="w-full"
          label={t('ap.settingsConfig')}
          value={jsonText}
          onChange={setJsonText}
          rows={10}
          inputClassName="font-mono text-caption-1-regular"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {isGrok ? (
            <Select
              label={t('ap.authMode')}
              className="w-full sm:col-span-2"
              popoverClassName="w-(--trigger-width)"
              selectedKey={form.authMode}
              onSelectionChange={(key) => {
                if (key === 'subscription' || key === 'api') updateForm({ authMode: key });
              }}
            >
              <SelectItem id="subscription" textValue={t('ap.authSubscription')}>{t('ap.authSubscription')}</SelectItem>
              <SelectItem id="api" textValue={t('ap.authApi')}>{t('ap.authApi')}</SelectItem>
            </Select>
          ) : null}
          {isDsh && editor.kind === 'new' ? (
            <Select
              label={t('ap.dshRouteKind')}
              className="w-full sm:col-span-2"
              popoverClassName="w-(--trigger-width)"
              selectedKey={dshDeepseek ? 'deepseek' : 'custom'}
              onSelectionChange={(key) => {
                if (key === 'deepseek') {
                  setId(DSH_DEEPSEEK_ROUTE);
                  updateForm({ apiKind: '', models: [], name: form.name || 'DeepSeek' });
                } else if (key === 'custom') {
                  if (dshDeepseek) setId('');
                  updateForm({ apiKind: form.apiKind || DSH_API_KINDS[0] });
                }
              }}
            >
              <SelectItem id="deepseek" textValue={t('ap.dshRouteDeepseek')}>{t('ap.dshRouteDeepseek')}</SelectItem>
              <SelectItem id="custom" textValue={t('ap.dshRouteCustom')}>{t('ap.dshRouteCustom')}</SelectItem>
            </Select>
          ) : null}
          {grokSubscription ? null : (
            <>
              <Field label={t('ap.baseUrl')} value={form.baseUrl} onChange={(baseUrl) => updateForm({ baseUrl })}
                description={isGrok ? t('ap.grokBaseUrlHint') : dshDeepseek ? t('ap.dshDeepseekBaseUrlHint') : undefined} />
              <Field label={t('ap.apiKey')} value={form.apiKey} onChange={(apiKey) => updateForm({ apiKey })} description={t('ap.secretKept')} />
            </>
          )}
          {isClaude || isCodex || isGrok ? (
            <Field label={t('ap.model')} value={form.model} onChange={(model) => updateForm({ model })}
              description={grokSubscription ? t('ap.grokModelHint') : undefined} />
          ) : null}
          {isGrok && !grokSubscription ? (
            <Select
              label={t('ap.apiKind')}
              className="w-full"
              popoverClassName="w-(--trigger-width)"
              placeholder={GROK_API_BACKENDS[0]}
              selectedKey={form.apiKind || null}
              onSelectionChange={(key) => {
                if (typeof key === 'string') updateForm({ apiKind: key });
              }}
            >
              {GROK_API_BACKENDS.map((backend) => (
                <SelectItem key={backend} id={backend} textValue={backend}>{backend}</SelectItem>
              ))}
            </Select>
          ) : null}
          {grokSubscription ? (
            <p className="text-caption-1-regular text-text-secondary sm:col-span-2">{t('ap.grokSubscriptionHint')}</p>
          ) : null}
          {isCodex ? (
            <>
              <Field label={t('ap.reasoningEffort')} value={form.reasoningEffort} onChange={(reasoningEffort) => updateForm({ reasoningEffort })} />
              <Field label={t('ap.contextWindow')} value={form.contextWindow} onChange={(contextWindow) => updateForm({ contextWindow })} />
            </>
          ) : null}
          {agent === 'pi' || (isDsh && !dshDeepseek) ? (
            <Select
              label={t('ap.apiKind')}
              className="w-full"
              popoverClassName="w-(--trigger-width)"
              selectedKey={form.apiKind || null}
              onSelectionChange={(key) => {
                if (typeof key === 'string') updateForm({ apiKind: key });
              }}
            >
              {(isDsh ? DSH_API_KINDS : apiKindOptions).map((kind) => (
                <SelectItem key={kind} id={kind} textValue={kind}>{kind}</SelectItem>
              ))}
            </Select>
          ) : null}
          {isAdditive ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <ModelsField
                ids={form.models.map((model) => model.id)}
                onChange={(ids) =>
                  updateForm({
                    models: ids.map(
                      (id) => form.models.find((model) => model.id === id) ?? emptyModelEntry(id),
                    ),
                  })
                }
                fetchModels={fetchEditorModels}
                autoFetch={editor.kind !== 'new' || Boolean(form.baseUrl.trim())}
              />
              <ModelConfigList
                agent={agent}
                models={form.models}
                onChange={(models) => updateForm({ models })}
              />
            </div>
          ) : null}
          {isDsh ? (
            <p className="text-caption-1-regular text-text-secondary sm:col-span-2">{t(dshDeepseek ? 'ap.dshDeepseekHint' : 'ap.dshCustomHint')}</p>
          ) : null}
        </div>
      )}

      {error ? <p className="text-caption-1-regular text-text-error-primary">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>{t('ap.cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{t('ap.save')}</Button>
      </div>
    </Card>
  );
}

/// Multi-select model list: fetched catalogs populate the options, while the
/// in-popover input appends ids the endpoint did not return.
function ModelsField({
  ids,
  onChange,
  fetchModels,
  autoFetch,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  fetchModels: () => Promise<Array<{ id: string; name: string }>>;
  autoFetch: boolean;
}) {
  const t = useT();
  const [fetched, setFetched] = useState<Array<{ id: string; name: string }>>();
  const [fetching, setFetching] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [draft, setDraft] = useState('');

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; label: string }> = [];
    for (const model of fetched ?? []) {
      if (model.id && !seen.has(model.id)) {
        seen.add(model.id);
        out.push({ id: model.id, label: model.name || model.id });
      }
    }
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ id, label: id });
      }
    }
    return out;
  }, [fetched, ids]);

  const runFetch = async () => {
    setFetching(true);
    try {
      setFetched(await fetchModels());
      setFetchFailed(false);
    } catch (error) {
      setFetchFailed(true);
      toast.danger(error instanceof Error ? error.message : t('ap.failed'));
    } finally {
      setFetching(false);
    }
  };

  const commitDraft = () => {
    const additions = modelIdsFromText(draft).filter((value) => !ids.includes(value));
    if (additions.length) onChange([...ids, ...additions]);
    setDraft('');
  };

  // A bespoke multi-select on the BoardUI select recipe (trigger, menu
  // surface, listbox rows): the popover carries an add/fetch row above the
  // options, which the stock BoardUI Select has no slot for.
  return (
    <div>
      <AriaSelect
        className="group flex w-full flex-col gap-1"
        selectionMode="multiple"
        // Open with no options too: the add/fetch row lives in the popover.
        allowsEmptyCollection
        value={ids}
        onChange={(keys) => onChange([...keys].map(String))}
        placeholder={t('ap.modelsHint')}
        onOpenChange={(open) => {
          if (open && autoFetch && fetched === undefined && !fetchFailed) void runFetch();
        }}
      >
        {({ isOpen }) => (
          <>
            <Label>{t('ap.models')}</Label>
            <AriaButton
              className={cx(
                'flex w-full cursor-pointer items-center justify-between gap-1.5 rounded-2lg px-2.5 py-2',
                'border border-border-button-default bg-background-primary-default text-body-medium text-text-primary shadow-xs',
                'transition-[background-color,border-color] duration-150 ease',
                'hover:border-border-button-hover hover:bg-background-primary-hover',
                'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2',
              )}
            >
              <AriaSelectValue className="flex min-w-0 items-center truncate data-[placeholder]:text-text-tertiary">
                {({ isPlaceholder, selectedItems }) =>
                  isPlaceholder
                    ? t('ap.modelsHint')
                    : t('ap.modelsSelected', { count: selectedItems.length })}
              </AriaSelectValue>
              <ChevronDownSmall
                className={cx('size-4 shrink-0 text-text-secondary transition-transform duration-200 ease', isOpen && 'rotate-180')}
              />
            </AriaButton>
            <AriaPopover offset={4} className={cx('w-(--trigger-width) min-w-64', MENU_POPOVER_SURFACE, 'p-2')}>
              <div className="mb-1 flex items-center gap-1 border-b border-separator-border pb-2">
                <Input
                  size="small"
                  className="min-w-0 flex-1"
                  placeholder={t('ap.addModelPlaceholder')}
                  aria-label={t('ap.addModelPlaceholder')}
                  value={draft}
                  onChange={setDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitDraft();
                    }
                  }}
                />
                <IconAction
                  icon={RiAddLine}
                  size="sm"
                  aria-label={t('ap.addModel')}
                  disabled={!draft.trim()}
                  onClick={commitDraft}
                />
                <IconAction
                  icon={fetching ? SpinnerIcon : RiRefreshLine}
                  size="sm"
                  aria-label={t('ap.fetchModels')}
                  aria-busy={fetching || undefined}
                  disabled={fetching}
                  onClick={() => void runFetch()}
                />
              </div>
              <AriaListBox
                className={cx(MENU_ITEMS_CONTAINER, 'max-h-[240px] overflow-auto')}
                renderEmptyState={() => (
                  <span className="block px-3 py-2 text-caption-1-regular text-text-secondary">{t('ap.noModels')}</span>
                )}
              >
                {options.map((option) => (
                  <AriaListBoxItem
                    key={option.id}
                    id={option.id}
                    textValue={option.id}
                    className={({ isFocused, isDisabled }) => cx(
                      MENU_ITEM,
                      'text-body-medium',
                      isFocused && MENU_ITEM_ACTIVE,
                      isDisabled && 'cursor-not-allowed text-text-disabled',
                    )}
                  >
                    {({ isSelected }) => (
                      <>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{option.label}</span>
                          {option.label !== option.id ? (
                            <span className="truncate text-caption-1-regular text-text-secondary">{option.id}</span>
                          ) : null}
                        </div>
                        {isSelected ? <RiCheckLine aria-hidden className="size-4 shrink-0 text-foreground-icon-primary" /> : null}
                      </>
                    )}
                  </AriaListBoxItem>
                ))}
              </AriaListBox>
            </AriaPopover>
          </>
        )}
      </AriaSelect>
      {ids.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {ids.map((id) => (
            <Chip key={id} variant="caption" color="neutral" className="gap-0.5 pe-1">
              {id}
              <button
                type="button"
                aria-label={t('ap.removeModel')}
                className="inline-flex cursor-pointer items-center rounded-xs text-foreground-icon-tertiary outline-none transition-colors duration-150 ease hover:text-foreground-icon-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                onClick={() => onChange(ids.filter((item) => item !== id))}
              >
                <RiCloseLine aria-hidden className="size-3.5" />
              </button>
            </Chip>
          ))}
        </div>
      ) : null}
      <p className="mt-1 text-caption-1-medium text-text-secondary">{t('ap.modelsHint')}</p>
    </div>
  );
}

/// Common context-window sizes listed in the combo box, at the exact token
/// counts models ship with: binary sizes for the 128K/1M classes (Qwen,
/// DeepSeek, Gemini), decimal for GPT-5's 272K input window. The input still
/// accepts any number (allowsCustomValue).
const CONTEXT_PRESETS = [
  { id: '131072', label: '128K' },
  { id: '272000', label: '272K' },
  { id: '1048576', label: '1M' },
] as const;

/// Per-model settings below the membership picker: context/output limits and
/// the enabled thinking levels. Rows stay collapsed to a one-line summary.
function ModelConfigList({
  agent,
  models,
  onChange,
}: {
  agent: ManagedProviderAgent;
  models: ModelFormEntry[];
  onChange: (models: ModelFormEntry[]) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!models.length) return null;
  const levels = thinkingLevelsFor(agent);
  const update = (id: string, patch: Partial<ModelFormEntry>) =>
    onChange(models.map((model) => (model.id === id ? { ...model, ...patch } : model)));
  return (
    <div className="flex flex-col rounded-2xl bg-background-secondary-default ps-3">
      {models.map((model) => {
        const open = expanded === model.id;
        const summary = [
          model.contextWindow.trim() ? `${model.contextWindow.trim()} ctx` : '',
          model.reasoning ? model.efforts.join('/') : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={model.id} className="border-b border-separator-border pe-2.5 last:border-b-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={open}
                className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                onClick={() => setExpanded(open ? null : model.id)}
              >
                <RiArrowDownSLine
                  aria-hidden
                  className={cx('size-4 shrink-0 text-foreground-icon-tertiary transition-transform duration-200 ease-out motion-reduce:transition-none', !open && '-rotate-90')}
                />
                <span className="truncate text-body-regular text-text-primary">{model.name || model.id}</span>
                {model.name ? (
                  <span className="truncate text-caption-1-regular text-text-tertiary">{model.id}</span>
                ) : null}
                {summary ? (
                  <span className="ml-auto shrink-0 pl-2 text-caption-1-regular text-text-secondary">{summary}</span>
                ) : null}
              </button>
              <IconAction
                icon={RiDeleteBinLine}
                size="sm"
                aria-label={t('ap.removeModel')}
                onClick={() => onChange(models.filter((item) => item.id !== model.id))}
              />
            </div>
            {open ? (
              <div className="grid gap-3 border-t border-separator-border py-3 sm:grid-cols-2">
                <Field
                  label={t('ap.displayName')}
                  value={model.name}
                  onChange={(name) => update(model.id, { name })}
                />
                <ComboBox
                  label={t('ap.contextWindow')}
                  allowsCustomValue
                  inputValue={model.contextWindow}
                  items={CONTEXT_PRESETS}
                  defaultFilter={() => true}
                  onInputChange={(contextWindow) => update(model.id, { contextWindow })}
                  onSelectionChange={(key) => {
                    if (key != null) update(model.id, { contextWindow: String(key) });
                  }}
                >
                  {(preset) => (
                    <ComboBoxItem id={preset.id} textValue={preset.id}>
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span>{preset.label}</span>
                        <span className="text-caption-1-regular text-text-secondary">{preset.id}</span>
                      </div>
                    </ComboBoxItem>
                  )}
                </ComboBox>
                <Field
                  label={t('ap.maxTokens')}
                  value={model.maxTokens}
                  onChange={(maxTokens) => update(model.id, { maxTokens })}
                />
                <div className="sm:col-span-2">
                  <Switch
                    size="sm"
                    isSelected={model.reasoning}
                    onChange={(reasoning) =>
                      update(model.id, {
                        reasoning,
                        efforts:
                          reasoning && !model.efforts.length ? defaultEfforts(agent) : model.efforts,
                      })
                    }
                  >
                    {t('ap.reasoning')}
                  </Switch>
                </div>
                {model.reasoning ? (
                  <div className="sm:col-span-2">
                    <p className="mb-1.5 text-caption-1-regular text-text-secondary">{t('ap.efforts')}</p>
                    <ButtonGroup size="small" aria-label={t('ap.efforts')} className="max-w-full">
                      {levels.map((level) => {
                        const enabled = model.efforts.includes(level);
                        return (
                          <ButtonGroupItem
                            key={level}
                            size="small"
                            selected={enabled}
                            aria-pressed={enabled}
                            className={cx(enabled ? 'bg-badge-new-background text-badge-new-text hover:bg-badge-new-background' : 'text-text-secondary')}
                            onClick={() =>
                              update(model.id, {
                                efforts: enabled
                                  ? model.efforts.filter((item) => item !== level)
                                  : [...model.efforts, level],
                              })
                            }
                          >
                            {level}
                          </ButtonGroupItem>
                        );
                      })}
                    </ButtonGroup>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

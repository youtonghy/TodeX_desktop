import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Chip, Input, Label, ListBox, Select, Spinner, Switch, TextArea, TextField, toast } from '@heroui/react';
import { RiAddLine, RiArrowDownSLine, RiCheckLine, RiCloseLine, RiDeleteBinLine, RiEdit2Line, RiRefreshLine, RiUserSettingsLine } from '@remixicon/react';
import {
  MANAGED_PROVIDER_AGENTS,
  PROVIDER_DISPLAY_NAMES,
  V2ApiClient,
  type AgentProviderBucket,
  type AgentProviderProfile,
  type AgentProvidersResponse,
  type ManagedProviderAgent,
} from '@todex/protocol/v2';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { ConnectionError } from '@todex/protocol/connectionError';
import { ProviderIcon } from '../components/ProviderIcon';
import { Field } from '../components/Field';
import {
  asRecord,
  buildSettingsConfig,
  defaultEfforts,
  emptyModelEntry,
  extractFormValues,
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
  const api = useCallback(() => new V2ApiClient({
    serverUrl: session.settings.serverUrl,
    device: deviceIdentityFromSecret(session.settings.deviceSecret),
  }), [session.settings.deviceSecret, session.settings.serverUrl]);

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

  const activeBackend = session.backendConnections.find((item) => item.id === session.activeBackendConnectionId);
  const additiveAgent = agent === 'pi' || agent === 'opencode';
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
      session={session}
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
    <div className="flex flex-col gap-4 p-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="bg-accent-soft text-accent flex size-10 shrink-0 items-center justify-center rounded-lg">
          <RiUserSettingsLine className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{activeBackend?.name || t('cli.currentBackend')}</h2>
          <p className="text-muted truncate text-xs" title={session.settings.serverUrl}>{session.settings.serverUrl}</p>
        </div>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('ap.refresh')} isDisabled={loading} onPress={() => void refresh()}>
          <RiRefreshLine className="size-4" />
        </Button>
      </div>

      <p className="text-muted -mt-2 text-xs">{t(additiveAgent ? 'ap.globalNoteAdditive' : 'ap.globalNote')}</p>

      <div className="flex flex-wrap gap-2">
        {MANAGED_PROVIDER_AGENTS.map((id) => (
          <Button key={id} size="sm" variant={agent === id ? 'primary' : 'tertiary'} onPress={() => { setAgent(id); setEditor(null); }}>
            <ProviderIcon provider={id} className="size-4" />
            {PROVIDER_DISPLAY_NAMES[id]}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner aria-label={t('cli.reading')} /></div>
      ) : !bucket ? (
        <p className="text-muted py-10 text-center text-sm">{t('ap.unsupported')}</p>
      ) : (
        <>
          {liveMismatch ? (
            <Card className="border-warning/40 rounded-lg p-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-warning flex-1">{t('ap.liveMismatch')}</span>
                <Button size="sm" variant="tertiary" isDisabled={Boolean(busy)}
                  onPress={() => void run('import-live', () => api().importLiveAgentProvider(agent, 'imported', t('ap.importedName')), 'ap.imported')}>
                  {t('ap.importLive')}
                </Button>
              </div>
            </Card>
          ) : null}

          <div className="grid gap-3">
            {bucket.providers.map((profile) => {
              const editingThis = editor?.kind === 'edit' && editor.profile.id === profile.id;
              const settings = profile.settingsConfig as Record<string, unknown>;
              const isCurrent = !additive && bucket.currentProviderId === profile.id;
              const isDefault = liveSelection?.providerId === profile.id;
              const defaultModelId = isDefault ? liveSelection?.modelId : null;
              const modelIds = providerModelIds(agent, settings);
              return (
                <Fragment key={profile.id}>
                <Card className="min-w-0 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-surface-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <ProviderIcon className="size-5" provider={agent} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{profile.name}</h3>
                        {isCurrent ? <Chip size="sm" variant="soft" color="success">{t('ap.active')}</Chip> : null}
                        {isDefault ? <Chip size="sm" variant="soft" color="success">{t('ap.default')}</Chip> : null}
                      </div>
                      <p className="text-muted mt-1 truncate text-xs">{providerBaseUrl(agent, settings) || profile.id}</p>
                      {additive && modelIds.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {modelIds.map((modelId) => (
                            <Chip key={modelId} size="sm" variant="soft"
                              color={modelId === defaultModelId ? 'success' : undefined}>
                              {modelId}
                            </Chip>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button isIconOnly size="sm" variant="ghost" aria-label={t('ap.edit')}
                        onPress={() => setEditor({ kind: 'edit', profile })}>
                        <RiEdit2Line className="size-4" />
                      </Button>
                      <Button isIconOnly size="sm" variant="ghost" aria-label={t('ap.delete')}
                        isDisabled={busy === `delete:${profile.id}`} onPress={() => remove(profile)}>
                        <RiDeleteBinLine className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {!additive && !isCurrent ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="primary" isDisabled={Boolean(busy)}
                        onPress={() => activate(profile)}>
                        {busy === `activate:${profile.id}` ? <Spinner size="sm" /> : <RiCheckLine className="size-4" />}
                        {t('ap.activate')}
                      </Button>
                    </div>
                  ) : null}
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
                <Card className="min-w-0 rounded-lg border-dashed p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{nodeId}</h3>
                        <Chip size="sm" variant="soft">{t('ap.unmanaged')}</Chip>
                        {isLiveSelection ? <Chip size="sm" variant="soft" color="success">{t('ap.default')}</Chip> : null}
                      </div>
                      {nodeBaseUrl ? (
                        <p className="text-muted mt-1 truncate text-xs">{nodeBaseUrl}</p>
                      ) : null}
                      {nodeModels.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {nodeModels.map((modelId) => (
                            <Chip key={modelId} size="sm" variant="soft"
                              color={isLiveSelection && liveSelection?.modelId === modelId ? 'success' : undefined}>
                              {modelId}
                            </Chip>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <Button size="sm" variant="secondary" isDisabled={Boolean(busy)} onPress={() => setEditor({ kind: 'adopt', nodeId })}>
                      {t('ap.adopt')}
                    </Button>
                  </div>
                </Card>
                {adoptingThis ? renderEditor() : null}
                </Fragment>
              );
            })}

            {bucket.providers.length === 0 && unmanaged.length === 0 ? (
              <p className="text-muted py-8 text-center text-sm">{t('ap.noProviders')}</p>
            ) : null}
          </div>

          {editor?.kind === 'new' ? renderEditor() : (
            <Button variant="secondary" onPress={() => setEditor({ kind: 'new' })}>
              <RiAddLine className="size-4" />
              {t('ap.add')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function ProviderEditor({
  session,
  agent,
  editor,
  unmanagedNodes,
  busy,
  onCancel,
  onSave,
}: {
  session: TodeXSession;
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
  const [form, setForm] = useState<ProviderFormValues>(() => extractFormValues(agent, baseSource));
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
  const isAdditive = agent === 'pi' || agent === 'opencode';

  const apiKindOptions =
    form.apiKind && !PI_API_KINDS.includes(form.apiKind)
      ? [...PI_API_KINDS, form.apiKind]
      : PI_API_KINDS;

  // The backend resolves masked secrets against the stored profile or the
  // live additive node of the same id, so this works pre-save in all modes.
  const fetchEditorModels = async () => {
    const client = new V2ApiClient({
      serverUrl: session.settings.serverUrl,
      device: deviceIdentityFromSecret(session.settings.deviceSecret),
    });
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

  return (
    <Card className="rounded-lg p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {editor.kind === 'new' ? t('ap.add') : editor.kind === 'adopt' ? t('ap.adopt') : t('ap.edit')}
          </h3>
          <div className="flex gap-1">
            <Button size="sm" variant={jsonMode ? 'ghost' : 'secondary'} onPress={() => setJsonMode(false)}>{t('ap.formMode')}</Button>
            <Button size="sm" variant={jsonMode ? 'secondary' : 'ghost'} onPress={() => {
              if (!jsonMode && (editor.kind === 'new' || formDirty)) {
                setJsonText(JSON.stringify(buildSettingsConfig(agent, form, baseSource), null, 2));
                setFormDirty(false);
              }
              setJsonMode(true);
            }}>{t('ap.jsonMode')}</Button>
          </div>
        </div>

        {editor.kind === 'adopt' ? (
          <p className="text-muted text-xs">{t('ap.adoptParsed')}</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ap.name')} value={form.name} onChange={(name) => updateForm({ name })} />
          <TextField className="w-full" value={id} onChange={setId} isDisabled={idLocked}>
            <Label>{t('ap.providerId')}</Label>
            <Input className="w-full" placeholder="my-provider" />
          </TextField>
        </div>

        {jsonMode ? (
          <TextField className="w-full" value={jsonText} onChange={setJsonText}>
            <Label>{t('ap.settingsConfig')}</Label>
            <TextArea className="w-full font-mono text-xs" rows={10} />
          </TextField>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('ap.baseUrl')} value={form.baseUrl} onChange={(baseUrl) => updateForm({ baseUrl })} />
            <Field label={t('ap.apiKey')} value={form.apiKey} onChange={(apiKey) => updateForm({ apiKey })} description={t('ap.secretKept')} />
            {isClaude || isCodex ? (
              <Field label={t('ap.model')} value={form.model} onChange={(model) => updateForm({ model })} />
            ) : null}
            {isCodex ? (
              <>
                <Field label={t('ap.reasoningEffort')} value={form.reasoningEffort} onChange={(reasoningEffort) => updateForm({ reasoningEffort })} />
                <Field label={t('ap.contextWindow')} value={form.contextWindow} onChange={(contextWindow) => updateForm({ contextWindow })} />
              </>
            ) : null}
            {agent === 'pi' ? (
              <Select
                className="w-full"
                selectedKey={form.apiKind || null}
                onSelectionChange={(key) => {
                  if (typeof key === 'string') updateForm({ apiKind: key });
                }}
              >
                <Label>{t('ap.apiKind')}</Label>
                <Select.Trigger className="w-full"><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {apiKindOptions.map((kind) => (
                      <ListBox.Item key={kind} id={kind} textValue={kind}>
                        {kind}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
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
          </div>
        )}

        {error ? <p className="text-danger text-xs">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onCancel}>{t('ap.cancel')}</Button>
          <Button variant="primary" isDisabled={busy} onPress={save}>{t('ap.save')}</Button>
        </div>
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

  return (
    <div>
      <Select
        className="w-full"
        selectionMode="multiple"
        value={ids}
        onChange={(keys) => onChange([...keys].map(String))}
        placeholder={t('ap.modelsHint')}
        onOpenChange={(open) => {
          if (open && autoFetch && fetched === undefined && !fetchFailed) void runFetch();
        }}
      >
        <Label>{t('ap.models')}</Label>
        <Select.Trigger className="w-full">
          <Select.Value>
            {({ isPlaceholder, selectedItems }) =>
              isPlaceholder
                ? t('ap.modelsHint')
                : t('ap.modelsSelected', { count: selectedItems.length })}
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <div className="border-separator flex items-center gap-1 border-b p-1">
            <Input
              className="h-8 min-w-0 flex-1 text-xs"
              placeholder={t('ap.addModelPlaceholder')}
              aria-label={t('ap.addModelPlaceholder')}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                }
              }}
            />
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={t('ap.addModel')}
              isDisabled={!draft.trim()}
              onPress={commitDraft}
            >
              <RiAddLine className="size-4" />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label={t('ap.fetchModels')}
              isDisabled={fetching}
              onPress={() => void runFetch()}
            >
              {fetching ? <Spinner size="sm" /> : <RiRefreshLine className="size-4" />}
            </Button>
          </div>
          <ListBox
            renderEmptyState={() => (
              <span className="text-muted block px-3 py-2 text-xs">{t('ap.noModels')}</span>
            )}
          >
            {options.map((option) => (
              <ListBox.Item key={option.id} id={option.id} textValue={option.id}>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.label !== option.id ? (
                    <span className="text-muted truncate text-xs">{option.id}</span>
                  ) : null}
                </div>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      {ids.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {ids.map((id) => (
            <Chip key={id} size="sm" variant="soft" className="gap-0.5 pr-1">
              {id}
              <button
                type="button"
                aria-label={t('ap.removeModel')}
                className="text-muted hover:text-foreground inline-flex items-center"
                onClick={() => onChange(ids.filter((item) => item !== id))}
              >
                <RiCloseLine className="size-3.5" />
              </button>
            </Chip>
          ))}
        </div>
      ) : null}
      <p className="text-muted mt-1 text-xs">{t('ap.modelsHint')}</p>
    </div>
  );
}

/// Common context-window sizes offered as one-tap presets; the field still
/// accepts any number.
const CONTEXT_PRESETS = [
  { label: '128K', value: '128000' },
  { label: '272K', value: '272000' },
  { label: '1M', value: '1000000' },
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
    <div className="flex flex-col gap-2">
      {models.map((model) => {
        const open = expanded === model.id;
        const summary = [
          model.contextWindow.trim() ? `${model.contextWindow.trim()} ctx` : '',
          model.reasoning ? model.efforts.join('/') : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={model.id} className="border-separator rounded-lg border">
            <div className="flex items-center gap-1 px-2">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left"
                onClick={() => setExpanded(open ? null : model.id)}
              >
                <RiArrowDownSLine
                  className={`text-muted size-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
                />
                <span className="truncate text-sm">{model.name || model.id}</span>
                {model.name ? (
                  <span className="text-muted truncate text-xs">{model.id}</span>
                ) : null}
                {summary ? (
                  <span className="text-muted ml-auto shrink-0 pl-2 text-xs">{summary}</span>
                ) : null}
              </button>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={t('ap.removeModel')}
                onPress={() => onChange(models.filter((item) => item.id !== model.id))}
              >
                <RiDeleteBinLine className="size-4" />
              </Button>
            </div>
            {open ? (
              <div className="border-separator grid gap-3 border-t px-3 py-3 sm:grid-cols-2">
                <Field
                  label={t('ap.displayName')}
                  value={model.name}
                  onChange={(name) => update(model.id, { name })}
                />
                <div>
                  <Field
                    label={t('ap.contextWindow')}
                    value={model.contextWindow}
                    onChange={(contextWindow) => update(model.id, { contextWindow })}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {CONTEXT_PRESETS.map((preset) => (
                      <Button
                        key={preset.value}
                        size="sm"
                        variant={model.contextWindow.trim() === preset.value ? 'secondary' : 'tertiary'}
                        onPress={() => update(model.id, { contextWindow: preset.value })}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <Field
                  label={t('ap.maxTokens')}
                  value={model.maxTokens}
                  onChange={(maxTokens) => update(model.id, { maxTokens })}
                />
                <Switch
                  isSelected={model.reasoning}
                  onChange={(reasoning) =>
                    update(model.id, {
                      reasoning,
                      efforts:
                        reasoning && !model.efforts.length ? defaultEfforts(agent) : model.efforts,
                    })
                  }
                >
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <p className="text-sm">{t('ap.reasoning')}</p>
                  </Switch.Content>
                </Switch>
                {model.reasoning ? (
                  <div className="sm:col-span-2">
                    <p className="text-muted mb-1.5 text-xs">{t('ap.efforts')}</p>
                    <div className="flex flex-wrap gap-1">
                      {levels.map((level) => {
                        const enabled = model.efforts.includes(level);
                        return (
                          <Button
                            key={level}
                            size="sm"
                            variant={enabled ? 'primary' : 'tertiary'}
                            onPress={() =>
                              update(model.id, {
                                efforts: enabled
                                  ? model.efforts.filter((item) => item !== level)
                                  : [...model.efforts, level],
                              })
                            }
                          >
                            {level}
                          </Button>
                        );
                      })}
                    </div>
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

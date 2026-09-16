import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Input, Label, ListBox, Select, Spinner, TextArea, TextField, toast } from '@heroui/react';
import { RiAddLine, RiCheckLine, RiDeleteBinLine, RiEdit2Line, RiListCheck2, RiRefreshLine, RiUserSettingsLine } from '@remixicon/react';
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
import { ProviderIcon } from '../components/ProviderIcon';
import { Field } from '../components/Field';
import {
  buildSettingsConfig,
  extractFormValues,
  providerBaseUrl,
  providerModelIds,
  type ProviderFormValues,
} from '../lib/agentProviders';
import { useT } from '../i18n';
import type { TodeXSession } from '../session/useTodeXSession';

type EditorState =
  | { kind: 'new' }
  | { kind: 'edit'; profile: AgentProviderProfile }
  | { kind: 'adopt'; nodeId: string }
  | null;

export function AgentProvidersPanel({ session }: { session: TodeXSession }) {
  const t = useT();
  const [agent, setAgent] = useState<ManagedProviderAgent>('codex');
  const [agents, setAgents] = useState<AgentProvidersResponse['agents']>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [editor, setEditor] = useState<EditorState>(null);
  const [modelChoice, setModelChoice] = useState<Record<string, string>>({});
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
    const settings = profile.settingsConfig as Record<string, unknown>;
    const modelId = modelChoice[profile.id] ?? providerModelIds(agent, settings)[0];
    void run(`activate:${profile.id}`,
      () => api().activateAgentProvider(agent, profile.id, modelId), 'ap.activated');
  };

  const remove = (profile: AgentProviderProfile) => {
    void run(`delete:${profile.id}`, async () => {
      await api().deleteAgentProvider(agent, profile.id);
      await refresh(true);
    }, 'ap.deleted');
  };

  const activeBackend = session.backendConnections.find((item) => item.id === session.activeBackendConnectionId);
  const additive = bucket?.mode === 'additive';
  const live = bucket?.live;
  const unmanaged = live?.kind === 'additive' ? live.unmanagedProviders : [];
  const unmanagedNodes = live?.kind === 'additive' ? live.providers : {};
  const liveMismatch = live?.kind === 'exclusive' && live.configured && !live.matchesCurrent;

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

      <p className="text-muted -mt-2 text-xs">{t('ap.globalNote')}</p>

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
              const settings = profile.settingsConfig as Record<string, unknown>;
              const isCurrent = bucket.currentProviderId === profile.id;
              const modelIds = providerModelIds(agent, settings);
              return (
                <Card key={profile.id} className="min-w-0 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-surface-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <ProviderIcon className="size-5" provider={agent} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{profile.name}</h3>
                        {isCurrent ? <Chip size="sm" variant="soft" color="success">{t('ap.active')}</Chip> : null}
                      </div>
                      <p className="text-muted mt-1 truncate text-xs">{providerBaseUrl(agent, settings) || profile.id}</p>
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
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {additive && modelIds.length > 1 ? (
                      <Select
                        className="w-44"
                        selectedKey={modelChoice[profile.id] ?? modelIds[0]}
                        onSelectionChange={(key) => {
                          if (typeof key === 'string') setModelChoice((current) => ({ ...current, [profile.id]: key }));
                        }}
                      >
                        <Label className="sr-only">{t('ap.model')}</Label>
                        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {modelIds.map((id) => (
                              <ListBox.Item key={id} id={id} textValue={id}>{id}</ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    ) : null}
                    {!isCurrent ? (
                      <Button size="sm" variant="primary" isDisabled={Boolean(busy)}
                        onPress={() => activate(profile)}>
                        {busy === `activate:${profile.id}` ? <Spinner size="sm" /> : <RiCheckLine className="size-4" />}
                        {t('ap.activate')}
                      </Button>
                    ) : null}
                    <FetchModelsButton session={session} agent={agent} id={profile.id} />
                  </div>
                </Card>
              );
            })}

            {unmanaged.map((nodeId) => (
              <Card key={nodeId} className="min-w-0 rounded-lg border-dashed p-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{nodeId}</h3>
                      <Chip size="sm" variant="soft">{t('ap.unmanaged')}</Chip>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" isDisabled={Boolean(busy)} onPress={() => setEditor({ kind: 'adopt', nodeId })}>
                    {t('ap.adopt')}
                  </Button>
                </div>
              </Card>
            ))}

            {bucket.providers.length === 0 && unmanaged.length === 0 ? (
              <p className="text-muted py-8 text-center text-sm">{t('ap.noProviders')}</p>
            ) : null}
          </div>

          {editor ? (
            <ProviderEditor
              agent={agent}
              editor={editor}
              unmanagedNodes={unmanagedNodes}
              busy={Boolean(busy)}
              onCancel={() => setEditor(null)}
              onSave={(id, input) => void run('save', async () => {
                const next = await api().upsertAgentProvider(agent, id, input);
                setEditor(null);
                return next;
              }, 'ap.saved')}
            />
          ) : (
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

function FetchModelsButton({ session, agent, id }: { session: TodeXSession; agent: ManagedProviderAgent; id: string }) {
  const t = useT();
  const [models, setModels] = useState<Array<{ id: string; name: string }>>();
  const [loading, setLoading] = useState(false);
  const fetch = async () => {
    setLoading(true);
    try {
      const api = new V2ApiClient({
        serverUrl: session.settings.serverUrl,
        device: deviceIdentityFromSecret(session.settings.deviceSecret),
      });
      setModels((await api.listAgentProviderModels(agent, id)).models);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('ap.failed'));
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="tertiary" isDisabled={loading} onPress={() => void fetch()}>
        {loading ? <Spinner size="sm" /> : <RiListCheck2 className="size-4" />}
        {t('ap.fetchModels')}
      </Button>
      {models ? (
        <div className="mt-1 flex w-full flex-wrap gap-1">
          {models.length ? models.map((model) => (
            <Chip key={model.id} size="sm" variant="soft">{model.name}</Chip>
          )) : <span className="text-muted text-xs">{t('ap.noModels')}</span>}
        </div>
      ) : null}
    </>
  );
}

function ProviderEditor({
  agent,
  editor,
  unmanagedNodes,
  busy,
  onCancel,
  onSave,
}: {
  agent: ManagedProviderAgent;
  editor: Exclude<EditorState, null>;
  unmanagedNodes: Record<string, unknown>;
  busy: boolean;
  onCancel: () => void;
  onSave: (id: string, input: { name: string; settingsConfig: Record<string, unknown> }) => void;
}) {
  const t = useT();
  const profile = editor.kind === 'edit' ? editor.profile : undefined;
  const initialSettings = editor.kind === 'adopt' ? unmanagedNodes[editor.nodeId] : undefined;
  const [form, setForm] = useState<ProviderFormValues>(() => ({
    ...extractFormValues(agent, profile),
    name: editor.kind === 'adopt' ? editor.nodeId : (profile?.name ?? ''),
  }));
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(
    profile?.settingsConfig ?? initialSettings ?? {},
    null,
    2,
  ));
  const [id, setId] = useState(() => editor.kind === 'adopt' ? editor.nodeId : (profile?.id ?? ''));
  const [error, setError] = useState('');

  const idLocked = editor.kind !== 'new';
  const isClaude = agent === 'claude-code';
  const isCodex = agent === 'codex';
  const isAdditive = agent === 'pi' || agent === 'opencode';

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
    onSave(providerId, { name, settingsConfig: buildSettingsConfig(agent, form, profile) });
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
              if (!jsonMode && !profile && editor.kind !== 'adopt') {
                setJsonText(JSON.stringify(buildSettingsConfig(agent, form, profile), null, 2));
              }
              setJsonMode(true);
            }}>{t('ap.jsonMode')}</Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ap.name')} value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} />
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
            <Field label={t('ap.baseUrl')} value={form.baseUrl} onChange={(baseUrl) => setForm((f) => ({ ...f, baseUrl }))} />
            <Field label={t('ap.apiKey')} value={form.apiKey} onChange={(apiKey) => setForm((f) => ({ ...f, apiKey }))} description={t('ap.secretKept')} />
            {isClaude || isCodex ? (
              <Field label={t('ap.model')} value={form.model} onChange={(model) => setForm((f) => ({ ...f, model }))} />
            ) : null}
            {isCodex ? (
              <Field label={t('ap.reasoningEffort')} value={form.reasoningEffort} onChange={(reasoningEffort) => setForm((f) => ({ ...f, reasoningEffort }))} />
            ) : null}
            {agent === 'pi' ? (
              <Field label={t('ap.apiKind')} value={form.apiKind} onChange={(apiKind) => setForm((f) => ({ ...f, apiKind }))} description="openai-completions / anthropic-messages / …" />
            ) : null}
            {isAdditive ? (
              <Field label={t('ap.models')} value={form.modelsText} onChange={(modelsText) => setForm((f) => ({ ...f, modelsText }))} description={t('ap.modelsHint')} />
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

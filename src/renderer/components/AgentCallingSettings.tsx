import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentCallingApproval, AgentCallingSettings as Settings, AgentScope, ApiKeySummary } from '@todex/protocol/v2';
import { ConnectionError } from '@todex/protocol/connectionError';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';
import { usePanelBackend, type PanelBackend } from '../session/panelBackend';
import { BackendScopeRow } from './settings/BackendScopeRow';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow, SettingsValueField } from './settings/SettingsRows';
import { toast } from './ui/toast';
import { AgentScopeSettings, ROW_SELECT_TRIGGER, scopeAllowsAgent } from './agentCalling/AgentScopeSettings';
import { APPROVAL_LABELS, APPROVALS } from './agentCalling/ApiKeyFormModal';
import { ApiKeysSection } from './agentCalling/ApiKeysSection';
import { CliUsageGuide } from './agentCalling/CliUsageGuide';

/**
 * Settings → Agent Calling for the picked backend. One scope (which agents
 * and models may be called) serves two entry points: the `todex_agents` MCP
 * server agents use to call each other, and the external API (`/api/v1`)
 * that API keys reach from a terminal.
 */
export function AgentCallingSettings({ session }: { session: TodeXSession }) {
  const backend = usePanelBackend(session);
  return (
    <div className="flex flex-col gap-6">
      <BackendScopeRow session={session} backend={backend} />
      <BackendAgentCallingSettings key={backend.backendId} session={session} backend={backend} />
    </div>
  );
}

function BackendAgentCallingSettings({ session, backend }: { session: TodeXSession; backend: PanelBackend }) {
  const t = useT();
  const transport = backend.settings;
  const api = useMemo(
    () => backendApi(transport),
    [transport.deviceSecret, transport.encryptionProtocol, transport.encryptionPublicKey, transport.transportVerified, transport.serverUrl],
  );
  // `null`: the backend predates Agent Calling.
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [keys, setKeys] = useState<ApiKeySummary[] | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [port, setPort] = useState('');

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.getAgentCalling());
    } catch (error) {
      // A transient failure keeps the last known settings; only a backend
      // without Agent Calling clears them.
      setSettings(current => error instanceof ConnectionError && error.httpStatus === 404 ? null : current);
    }
    try {
      setKeys((await api.listApiKeys()).keys);
    } catch {
      setKeys(current => current ?? []);
    }
  }, [api]);
  useEffect(() => {
    setSettings(undefined);
    setKeys(undefined);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (settings) setPort(String(settings.apiListener.port));
  }, [settings?.apiListener.port]);

  const save = async (work: () => Promise<Settings>) => {
    setSaving(true);
    try {
      setSettings(await work());
    } catch (error) {
      toast.danger(t('agentCalling.saveFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  if (settings === null) {
    return (
      <SettingsCard>
        <SettingsNote className="py-3 text-body-regular">{t('agentCalling.unsupported')}</SettingsNote>
      </SettingsCard>
    );
  }

  const workspace = session.activeWorkspace?.path ?? '';
  const providers = backend.providers;
  const disabled = settings === undefined || saving;
  const scope: AgentScope = settings?.scope ?? { agents: null, models: {} };
  const firstAgent = settings ? providers.find(provider => provider.available && scopeAllowsAgent(scope, provider.id))?.id ?? '' : '';
  const listener = settings?.apiListener;
  const portNumber = Number(port);
  const portValid = /^\d+$/.test(port.trim()) && portNumber >= 1 && portNumber <= 65535;
  const portChanged = listener !== undefined && portValid && portNumber !== listener.port;
  const savePort = () => {
    if (portChanged) void save(() => api.setApiListener({ port: portNumber }));
  };
  const mcp = settings?.mcp;

  return (
    <div className="flex flex-col gap-6">
      <AgentScopeSettings
        api={api}
        providers={providers}
        scope={scope}
        workspace={workspace}
        disabled={disabled}
        onChange={next => { void save(() => api.setAgentCalling({ scope: next })); }}
      />

      <SettingsGroup label={t('agentCalling.mcpTitle')} description={t('agentCalling.mcpHint')}>
        <SettingsCard>
          <SettingsRow label={t('agentCalling.mcpEnable')} description={t('agentCalling.mcpEnableHint')}>
            {mcp ? (
              <Chip variant="caption" color={mcp.injected ? 'lime' : 'neutral'}>
                {t(mcp.injected ? 'agentCalling.mcpActive' : 'agentCalling.mcpInactive')}
              </Chip>
            ) : null}
            <Switch
              size="sm"
              aria-label={t('agentCalling.mcpEnable')}
              isSelected={mcp?.enabled === true}
              isDisabled={disabled}
              onChange={enabled => { void save(() => api.setAgentCalling({ mcp: { enabled } })); }}
            />
          </SettingsRow>
          <SettingsRow label={t('agentCalling.approval')} description={t('agentCalling.mcpApprovalHint')}>
            <Select
              aria-label={t('agentCalling.approval')}
              selectedKey={mcp?.approval ?? 'ask'}
              isDisabled={disabled}
              triggerClassName={ROW_SELECT_TRIGGER}
              onSelectionChange={(value) => {
                if (APPROVALS.includes(value as AgentCallingApproval)) void save(() => api.setAgentCalling({ mcp: { approval: value as AgentCallingApproval } }));
              }}
            >
              {APPROVALS.map(id => <SelectItem key={id} id={id} textValue={t(APPROVAL_LABELS[id])}>{t(APPROVAL_LABELS[id])}</SelectItem>)}
            </Select>
          </SettingsRow>
          {mcp?.enabled && !mcp.injected ? <SettingsNote tone="warning">{t('agentCalling.mcpNoAgents')}</SettingsNote> : null}
          {settings ? (
            <SettingsNote>
              {t('agentCalling.limits', {
                calls: settings.limits.maxConcurrentCalls,
                wait: settings.limits.defaultWaitSecs,
                max: settings.limits.maxWaitSecs,
              })}
            </SettingsNote>
          ) : null}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('agentCalling.cliEntryTitle')} description={t('agentCalling.cliEntryHint')}>
        <SettingsCard>
          <SettingsRow label={t('agentCalling.listenerEnable')} description={t('agentCalling.listenerEnableHint')}>
            <Switch
              size="sm"
              aria-label={t('agentCalling.listenerEnable')}
              isSelected={listener?.enabled === true}
              isDisabled={disabled}
              onChange={enabled => { void save(() => api.setApiListener({ enabled })); }}
            />
          </SettingsRow>
          <SettingsRow label={t('agentCalling.listenerPort')} description={t('agentCalling.listenerPortHint', { host: listener?.host ?? '127.0.0.1' })}>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => { event.preventDefault(); savePort(); }}
            >
              <Input
                size="small"
                aria-label={t('agentCalling.listenerPort')}
                className="w-24"
                inputMode="numeric"
                value={port}
                onChange={setPort}
                isDisabled={disabled}
                isInvalid={port !== '' && !portValid}
              />
              {portChanged ? <Button type="submit" size="small" variant="secondary" disabled={disabled}>{t('common.save')}</Button> : null}
            </form>
          </SettingsRow>
          <SettingsRow label={t('agentCalling.listenerStatus')}>
            {listener ? (
              listener.listening && listener.baseUrl
                ? <SettingsValueField mono title={listener.baseUrl} className="w-auto max-w-80"><bdi dir="ltr">{listener.baseUrl}</bdi></SettingsValueField>
                : <Chip variant="caption" color="neutral">{t('agentCalling.listenerOff')}</Chip>
            ) : null}
          </SettingsRow>
          {listener?.pendingRestart ? <SettingsNote tone="warning">{t('agentCalling.listenerPendingRestart')}</SettingsNote> : null}
        </SettingsCard>
      </SettingsGroup>

      <ApiKeysSection
        api={api}
        keys={keys}
        providers={providers}
        defaultWorkspace={workspace}
        onKeysChange={update => setKeys(current => update(current ?? []))}
      />

      {listener ? <CliUsageGuide listener={listener} agent={firstAgent} workspace={workspace} /> : null}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Switch } from '@/components/base/switch/switch';
import { AGENT_LOCAL_HOST, isNotFoundError, type AgentLocalTerminal } from '@todex/protocol/ssh';
import { useT } from '../../i18n';
import { backendApi } from '../../session/helpers';
import type { PanelBackend } from '../../session/panelBackend';
import { toast } from '../ui/toast';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from './SettingsRows';

/**
 * Whether agents get a `Local` host in the TodeX SSH tools that runs commands
 * on the backend machine. The switch saves at once. Hidden on backends that
 * predate the setting, like the output filter card below it.
 */
export function AgentLocalTerminalSettings({ backend }: { backend: PanelBackend }) {
  const t = useT();
  const transport = backend.settings;
  const api = useMemo(
    () => backendApi(transport),
    [transport.deviceSecret, transport.encryptionProtocol, transport.encryptionPublicKey, transport.transportVerified, transport.serverUrl],
  );
  // `null`: the backend predates the setting.
  const [settings, setSettings] = useState<AgentLocalTerminal | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // An SSH host the Local host shadows for agents, when there is one.
  const [shadowedAlias, setShadowedAlias] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setSettings(await api.getAgentLocal());
    } catch (error) {
      if (isNotFoundError(error)) setSettings(null);
      else setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [api]);
  useEffect(() => {
    setSettings(undefined);
    void refresh();
  }, [refresh]);

  const enabled = settings?.enabled === true;
  useEffect(() => {
    setShadowedAlias(null);
    if (!enabled) return;
    let cancelled = false;
    const local = AGENT_LOCAL_HOST.toLowerCase();
    api.listSshHosts()
      .then(({ hosts }) => {
        if (!cancelled) setShadowedAlias(hosts.find(host => host.alias.toLowerCase() === local)?.alias ?? null);
      })
      // The warning is a courtesy; a failed host list just leaves it out.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, enabled]);

  const save = async (next: AgentLocalTerminal) => {
    setSaving(true);
    try {
      setSettings(await api.setAgentLocal(next));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentLocal.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (settings === null) return null;

  return (
    <SettingsGroup label={t('agentLocal.title')}>
      <SettingsCard>
        {settings === undefined && loadError ? (
          <SettingsRow description={<span className="text-text-error-primary">{t('agentLocal.loadFailed', { error: loadError })}</span>}>
            <Button size="small" variant="secondary" onClick={() => { void refresh(); }}>{t('settings.retry')}</Button>
          </SettingsRow>
        ) : (
          <>
            <SettingsRow label={t('agentLocal.enabled')} description={t('agentLocal.enabledHint')} align="start">
              <Switch
                size="sm"
                aria-label={t('agentLocal.enabled')}
                isSelected={enabled}
                isDisabled={settings === undefined || saving}
                onChange={(selected) => { if (settings) void save({ ...settings, enabled: selected }); }}
              />
            </SettingsRow>
            {enabled && shadowedAlias ? (
              <SettingsNote tone="warning">{t('agentLocal.shadowedHost', { alias: shadowedAlias })}</SettingsNote>
            ) : null}
          </>
        )}
      </SettingsCard>
    </SettingsGroup>
  );
}

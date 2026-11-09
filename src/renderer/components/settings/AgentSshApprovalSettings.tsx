import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Switch } from '@/components/base/switch/switch';
import { isNotFoundError, type AgentSshApproval, type AgentSshApprovalScope } from '@todex/protocol/ssh';
import { useT } from '../../i18n';
import { backendApi } from '../../session/helpers';
import type { PanelBackend } from '../../session/panelBackend';
import { toast } from '../ui/toast';
import { SettingsCard, SettingsGroup, SettingsRow } from './SettingsRows';

/**
 * Whether agents need the user's approval before the TodeX SSH tools connect
 * to a host, whatever the conversation's permission mode: once per host, or
 * every command. Every change saves at once. Hidden on backends that predate
 * the setting.
 */
export function AgentSshApprovalSettings({ backend }: { backend: PanelBackend }) {
  const t = useT();
  const transport = backend.settings;
  const api = useMemo(
    () => backendApi(transport),
    [transport.deviceSecret, transport.encryptionProtocol, transport.encryptionPublicKey, transport.transportVerified, transport.serverUrl],
  );
  // `null`: the backend predates the setting.
  const [settings, setSettings] = useState<AgentSshApproval | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setSettings(await api.getAgentSshApproval());
    } catch (error) {
      if (isNotFoundError(error)) setSettings(null);
      else setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [api]);
  useEffect(() => {
    setSettings(undefined);
    void refresh();
  }, [refresh]);

  const save = async (next: AgentSshApproval) => {
    setSaving(true);
    try {
      setSettings(await api.setAgentSshApproval(next));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentSshApproval.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (settings === null) return null;

  return (
    <SettingsGroup label={t('agentSshApproval.title')}>
      <SettingsCard>
        {settings === undefined && loadError ? (
          <SettingsRow description={<span className="text-text-error-primary">{t('agentSshApproval.loadFailed', { error: loadError })}</span>}>
            <Button size="small" variant="secondary" onClick={() => { void refresh(); }}>{t('settings.retry')}</Button>
          </SettingsRow>
        ) : (
          <>
            <SettingsRow label={t('agentSshApproval.enabled')} description={t('agentSshApproval.enabledHint')} align="start">
              <Switch
                size="sm"
                aria-label={t('agentSshApproval.enabled')}
                isSelected={settings?.enabled === true}
                isDisabled={settings === undefined || saving}
                onChange={(enabled) => { if (settings) void save({ ...settings, enabled }); }}
              />
            </SettingsRow>
            {settings?.enabled ? (
              <SettingsRow label={t('agentSshApproval.scope')} description={t('agentSshApproval.scopeHint')} align="start">
                <SegmentedControl
                  aria-label={t('agentSshApproval.scope')}
                  selectedKeys={[settings.scope]}
                  isDisabled={saving}
                  onSelectionChange={(keys) => {
                    const [scope] = [...keys] as AgentSshApprovalScope[];
                    if (scope && scope !== settings.scope) void save({ ...settings, scope });
                  }}
                >
                  <SegmentedControlItem id="host">{t('agentSshApproval.scopeHost')}</SegmentedControlItem>
                  <SegmentedControlItem id="command">{t('agentSshApproval.scopeCommand')}</SegmentedControlItem>
                </SegmentedControl>
              </SettingsRow>
            ) : null}
          </>
        )}
      </SettingsCard>
    </SettingsGroup>
  );
}

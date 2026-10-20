import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Switch } from '@/components/base/switch/switch';
import {
  AGENT_OUTPUT_FILTER_CATEGORIES,
  isNotFoundError,
  type AgentOutputFilter,
  type AgentOutputFilterCategory,
} from '@todex/protocol/ssh';
import { useT, type MessageKey } from '../../i18n';
import { backendApi } from '../../session/helpers';
import type { PanelBackend } from '../../session/panelBackend';
import { toast } from '../ui/toast';
import { SettingsCard, SettingsGroup, SettingsRow } from './SettingsRows';

const CATEGORY_KEYS: Record<AgentOutputFilterCategory, { label: MessageKey; hint: MessageKey }> = {
  privateKey: { label: 'agentOutputFilter.privateKey', hint: 'agentOutputFilter.privateKeyHint' },
  publicKey: { label: 'agentOutputFilter.publicKey', hint: 'agentOutputFilter.publicKeyHint' },
  credential: { label: 'agentOutputFilter.credential', hint: 'agentOutputFilter.credentialHint' },
  bankCard: { label: 'agentOutputFilter.bankCard', hint: 'agentOutputFilter.bankCardHint' },
  idCard: { label: 'agentOutputFilter.idCard', hint: 'agentOutputFilter.idCardHint' },
};

/**
 * What the backend hides from agents in `ssh_exec` output. Every switch saves
 * at once. Hidden on backends that predate the filter; the keepalive card
 * above already reports an outdated backend.
 */
export function AgentOutputFilterSettings({ backend }: { backend: PanelBackend }) {
  const t = useT();
  const transport = backend.settings;
  const api = useMemo(
    () => backendApi(transport),
    [transport.deviceSecret, transport.encryptionProtocol, transport.encryptionPublicKey, transport.transportVerified, transport.serverUrl],
  );
  // `null`: the backend predates the filter.
  const [filter, setFilter] = useState<AgentOutputFilter | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setFilter(await api.getAgentOutputFilter());
    } catch (error) {
      if (isNotFoundError(error)) setFilter(null);
      else setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [api]);
  useEffect(() => {
    setFilter(undefined);
    void refresh();
  }, [refresh]);

  const save = async (next: AgentOutputFilter) => {
    setSaving(true);
    try {
      setFilter(await api.setAgentOutputFilter(next));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentOutputFilter.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (filter === null) return null;

  const disabled = filter === undefined || saving;
  return (
    <SettingsGroup label={t('agentOutputFilter.title')}>
      <SettingsCard>
        {filter === undefined && loadError ? (
          <SettingsRow description={<span className="text-text-error-primary">{t('agentOutputFilter.loadFailed', { error: loadError })}</span>}>
            <Button size="small" variant="secondary" onClick={() => { void refresh(); }}>{t('settings.retry')}</Button>
          </SettingsRow>
        ) : (
          <>
            <SettingsRow label={t('agentOutputFilter.enabled')} description={t('agentOutputFilter.enabledHint')} align="start">
              <Switch
                size="sm"
                aria-label={t('agentOutputFilter.enabled')}
                isSelected={filter?.enabled === true}
                isDisabled={disabled}
                onChange={(selected) => { if (filter) void save({ ...filter, enabled: selected }); }}
              />
            </SettingsRow>
            {AGENT_OUTPUT_FILTER_CATEGORIES.map((category) => (
              <SettingsRow key={category} label={t(CATEGORY_KEYS[category].label)} description={t(CATEGORY_KEYS[category].hint)}>
                <Switch
                  size="sm"
                  aria-label={t(CATEGORY_KEYS[category].label)}
                  isSelected={filter?.categories[category] === true}
                  isDisabled={disabled || !filter?.enabled}
                  onChange={(selected) => {
                    if (filter) void save({ ...filter, categories: { ...filter.categories, [category]: selected } });
                  }}
                />
              </SettingsRow>
            ))}
          </>
        )}
      </SettingsCard>
    </SettingsGroup>
  );
}

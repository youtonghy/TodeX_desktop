import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { CloseButton } from '@/components/base/buttons/close-button';
import { Input } from '@/components/base/input/input';
import { Switch } from '@/components/base/switch/switch';
import {
  AGENT_OUTPUT_FILTER_AGGRESSIVE_CATEGORIES,
  AGENT_OUTPUT_FILTER_CUSTOM_KEYS_LIMIT,
  AGENT_OUTPUT_FILTER_STANDARD_CATEGORIES,
  isNotFoundError,
  isValidAgentOutputFilterKey,
  type AgentOutputFilter,
  type AgentOutputFilterCategory,
} from '@todex/protocol/ssh';
import { useT, type MessageKey } from '../../i18n';
import { backendApi } from '../../session/helpers';
import type { PanelBackend } from '../../session/panelBackend';
import { toast } from '../ui/toast';
import { SETTINGS_ROW, SettingsCard, SettingsGroup, SettingsRow } from './SettingsRows';

const CATEGORY_KEYS: Record<AgentOutputFilterCategory, { label: MessageKey; hint: MessageKey }> = {
  privateKey: { label: 'agentOutputFilter.privateKey', hint: 'agentOutputFilter.privateKeyHint' },
  publicKey: { label: 'agentOutputFilter.publicKey', hint: 'agentOutputFilter.publicKeyHint' },
  credential: { label: 'agentOutputFilter.credential', hint: 'agentOutputFilter.credentialHint' },
  bankCard: { label: 'agentOutputFilter.bankCard', hint: 'agentOutputFilter.bankCardHint' },
  idCard: { label: 'agentOutputFilter.idCard', hint: 'agentOutputFilter.idCardHint' },
  proxyCredential: { label: 'agentOutputFilter.proxyCredential', hint: 'agentOutputFilter.proxyCredentialHint' },
  urlToken: { label: 'agentOutputFilter.urlToken', hint: 'agentOutputFilter.urlTokenHint' },
  highEntropy: { label: 'agentOutputFilter.highEntropy', hint: 'agentOutputFilter.highEntropyHint' },
  uuid: { label: 'agentOutputFilter.uuid', hint: 'agentOutputFilter.uuidHint' },
  email: { label: 'agentOutputFilter.email', hint: 'agentOutputFilter.emailHint' },
  phone: { label: 'agentOutputFilter.phone', hint: 'agentOutputFilter.phoneHint' },
  publicIp: { label: 'agentOutputFilter.publicIp', hint: 'agentOutputFilter.publicIpHint' },
};

/**
 * What the backend hides from agents in `ssh_exec` output. Every switch saves
 * at once. Hidden on backends that predate the filter; the keepalive card
 * above already reports an outdated backend. Only the categories and fields
 * the backend reports are shown, so an older backend never gets a setting it
 * would reject.
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
      return true;
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentOutputFilter.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (filter === null) return null;

  const disabled = filter === undefined || saving;
  const known = (category: AgentOutputFilterCategory) => filter === undefined || category in filter.categories;
  const categoryRow = (category: AgentOutputFilterCategory) => (
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
  );
  const aggressive = filter ? AGENT_OUTPUT_FILTER_AGGRESSIVE_CATEGORIES.filter(known) : [];

  return (
    <>
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
              {AGENT_OUTPUT_FILTER_STANDARD_CATEGORIES.filter(known).map(categoryRow)}
            </>
          )}
        </SettingsCard>
      </SettingsGroup>
      {filter && aggressive.length ? (
        <SettingsGroup label={t('agentOutputFilter.aggressiveTitle')} description={t('agentOutputFilter.aggressiveHint')}>
          <SettingsCard>{aggressive.map(categoryRow)}</SettingsCard>
        </SettingsGroup>
      ) : null}
      {filter?.customKeys !== undefined ? (
        <CustomKeysEditor
          keys={filter.customKeys}
          isDisabled={disabled || !filter.enabled}
          onSave={keys => save({ ...filter, customKeys: keys })}
        />
      ) : null}
    </>
  );
}

/** Extra key names whose values are hidden like passwords. */
function CustomKeysEditor({ keys, isDisabled, onSave }: {
  keys: string[];
  isDisabled: boolean;
  onSave: (keys: string[]) => Promise<boolean>;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const key = draft.trim();
  const error = !key
    ? null
    : !isValidAgentOutputFilterKey(key)
      ? t('agentOutputFilter.customKeysInvalid')
      : keys.some(existing => existing.toLowerCase() === key.toLowerCase())
        ? t('agentOutputFilter.customKeysDuplicate')
        : keys.length >= AGENT_OUTPUT_FILTER_CUSTOM_KEYS_LIMIT
          ? t('agentOutputFilter.customKeysLimit', { count: AGENT_OUTPUT_FILTER_CUSTOM_KEYS_LIMIT })
          : null;
  const canAdd = Boolean(key) && !error && !isDisabled;
  const add = async () => {
    if (canAdd && await onSave([...keys, key])) setDraft('');
  };

  return (
    <SettingsGroup label={t('agentOutputFilter.customKeys')} description={t('agentOutputFilter.customKeysHint')}>
      <SettingsCard>
        {keys.length ? (
          <div className={SETTINGS_ROW}>
            <ul className="flex flex-wrap gap-1.5" dir="ltr" aria-label={t('agentOutputFilter.customKeys')}>
              {keys.map(existing => (
                <li key={existing}>
                  <Chip variant="caption" color="neutral" className="gap-1 pe-1">
                    <span className="font-mono">{existing}</span>
                    <CloseButton
                      size="2xs"
                      aria-label={t('agentOutputFilter.customKeysRemove', { key: existing })}
                      disabled={isDisabled}
                      onClick={() => { void onSave(keys.filter(other => other !== existing)); }}
                    />
                  </Chip>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className={SETTINGS_ROW}>
          <form
            className="flex items-start gap-2"
            onSubmit={(event) => { event.preventDefault(); void add(); }}
          >
            <Input
              aria-label={t('agentOutputFilter.customKeysPlaceholder')}
              placeholder={t('agentOutputFilter.customKeysPlaceholder')}
              size="small"
              className="min-w-0 flex-1"
              inputDir="ltr"
              value={draft}
              isDisabled={isDisabled}
              isInvalid={Boolean(error)}
              hint={error ?? undefined}
              onChange={setDraft}
            />
            <Button type="submit" size="small" variant="secondary" disabled={!canAdd}>
              {t('agentOutputFilter.customKeysAdd')}
            </Button>
          </form>
        </div>
      </SettingsCard>
    </SettingsGroup>
  );
}

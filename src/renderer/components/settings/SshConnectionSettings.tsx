import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Switch } from '@/components/base/switch/switch';
import { ConnectionError } from '@todex/protocol/connectionError';
import {
  SSH_SERVER_ALIVE_COUNT_MAX_RANGE,
  SSH_SERVER_ALIVE_INTERVAL_RANGE,
  type SshConnectionSettings as Settings,
} from '@todex/protocol/ssh';
import type { TodeXSession } from '../../session/useTodeXSession';
import { useT } from '../../i18n';
import { backendApi } from '../../session/helpers';
import { usePanelBackend, type PanelBackend } from '../../session/panelBackend';
import { AgentOutputFilterSettings } from './AgentOutputFilterSettings';
import { BackendScopeRow } from './BackendScopeRow';
import { toast } from '../ui/toast';
import { SettingsCard, SettingsNote, SettingsRow } from './SettingsRows';

type Range = { min: number; max: number };

/** The whole number in `text` when it lies within `range`. */
export function parseBoundedInteger(text: string, range: Range): number | undefined {
  if (!/^\s*\d+\s*$/.test(text)) return undefined;
  const value = Number(text);
  return value >= range.min && value <= range.max ? value : undefined;
}

/**
 * Connection defaults for every ssh run of the picked backend (terminals,
 * SFTP, agent commands). The switch saves at once; the numbers save with the
 * button, so a half-typed value never reaches the backend.
 */
export function SshConnectionSettings({ session }: { session: TodeXSession }) {
  const backend = usePanelBackend(session);
  return (
    <div className="flex flex-col gap-6">
      <BackendScopeRow session={session} backend={backend} />
      <BackendSshSettings key={backend.backendId} backend={backend} />
      <AgentOutputFilterSettings key={`filter:${backend.backendId}`} backend={backend} />
    </div>
  );
}

function BackendSshSettings({ backend }: { backend: PanelBackend }) {
  const t = useT();
  const transport = backend.settings;
  const api = useMemo(
    () => backendApi(transport),
    [transport.deviceSecret, transport.encryptionProtocol, transport.encryptionPublicKey, transport.transportVerified, transport.serverUrl],
  );
  // `null`: the backend predates SSH connection settings.
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [intervalText, setIntervalText] = useState('');
  const [countMaxText, setCountMaxText] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const show = (next: Settings) => {
    setSettings(next);
    setIntervalText(String(next.serverAliveInterval));
    setCountMaxText(String(next.serverAliveCountMax));
  };

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      show(await api.getSshSettings());
    } catch (error) {
      if (error instanceof ConnectionError && error.httpStatus === 404) setSettings(null);
      else setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [api]);
  useEffect(() => {
    // Settings of another backend must not stand in while this one loads.
    setSettings(undefined);
    void refresh();
  }, [refresh]);

  // The switch saves on its own and leaves unsaved numbers in the fields.
  const save = async (next: Settings, { keepDraft = false } = {}) => {
    setSaving(true);
    try {
      const saved = await api.setSshSettings(next);
      if (keepDraft) setSettings(saved);
      else show(saved);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('sshSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (settings === null) {
    return (
      <SettingsCard>
        <SettingsNote className="py-3 text-body-regular">{t('sshSettings.unsupported')}</SettingsNote>
      </SettingsCard>
    );
  }

  if (settings === undefined && loadError) {
    return (
      <SettingsCard>
        <SettingsRow description={<span className="text-text-error-primary">{t('sshSettings.loadFailed', { error: loadError })}</span>}>
          <Button size="small" variant="secondary" onClick={() => { void refresh(); }}>{t('settings.retry')}</Button>
        </SettingsRow>
      </SettingsCard>
    );
  }

  const parsedInterval = parseBoundedInteger(intervalText, SSH_SERVER_ALIVE_INTERVAL_RANGE);
  const parsedCountMax = parseBoundedInteger(countMaxText, SSH_SERVER_ALIVE_COUNT_MAX_RANGE);
  const changed = settings !== undefined
    && (parsedInterval !== settings.serverAliveInterval || parsedCountMax !== settings.serverAliveCountMax);
  const disabled = settings === undefined || saving;
  const detectSeconds = settings
    ? (parsedInterval ?? settings.serverAliveInterval) * (parsedCountMax ?? settings.serverAliveCountMax)
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <SettingsCard>
        <SettingsRow label={t('sshSettings.keepAlive')} description={detectSeconds === undefined ? undefined : t('sshSettings.keepAliveHint', { seconds: detectSeconds })}>
          <Switch
            size="sm"
            aria-label={t('sshSettings.keepAlive')}
            isSelected={settings?.serverAliveEnabled === true}
            isDisabled={disabled}
            onChange={(selected) => { if (settings) void save({ ...settings, serverAliveEnabled: selected }, { keepDraft: true }); }}
          />
        </SettingsRow>
        <BoundedIntegerRow
          label={t('sshSettings.interval')}
          description={t('sshSettings.intervalHint')}
          range={SSH_SERVER_ALIVE_INTERVAL_RANGE}
          value={intervalText}
          isInvalid={parsedInterval === undefined}
          isDisabled={disabled}
          onChange={setIntervalText}
        />
        <BoundedIntegerRow
          label={t('sshSettings.countMax')}
          description={t('sshSettings.countMaxHint')}
          range={SSH_SERVER_ALIVE_COUNT_MAX_RANGE}
          value={countMaxText}
          isInvalid={parsedCountMax === undefined}
          isDisabled={disabled}
          onChange={setCountMaxText}
        />
        <SettingsNote>{t('sshSettings.applyNote')}</SettingsNote>
      </SettingsCard>
      <div className="flex gap-2">
        <Button
          size="small"
          disabled={disabled || !changed || parsedInterval === undefined || parsedCountMax === undefined}
          onClick={() => {
            if (settings && parsedInterval !== undefined && parsedCountMax !== undefined) {
              void save({ ...settings, serverAliveInterval: parsedInterval, serverAliveCountMax: parsedCountMax });
            }
          }}
        >
          {t('common.save')}
        </Button>
        {changed ? (
          <Button size="small" variant="secondary" disabled={saving} onClick={() => { if (settings) show(settings); }}>{t('common.cancel')}</Button>
        ) : null}
      </div>
    </div>
  );
}

function BoundedIntegerRow({ label, description, range, value, isInvalid, isDisabled, onChange }: {
  label: string;
  description: string;
  range: Range;
  value: string;
  isInvalid: boolean;
  isDisabled: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  return (
    <SettingsRow label={label} description={description}>
      <Input
        aria-label={label}
        size="small"
        className="w-44"
        inputMode="numeric"
        inputDir="ltr"
        value={value}
        isDisabled={isDisabled}
        isInvalid={isInvalid}
        hint={isInvalid ? t('cliSettings.integerRange', range) : undefined}
        onChange={onChange}
      />
    </SettingsRow>
  );
}

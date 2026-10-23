import { useEffect, useState, type ReactNode } from 'react';
import { Radio, RadioGroup } from 'react-aria-components';
import { RiArrowLeftRightLine } from '@remixicon/react';
import { normalizeServerUrl } from '@todex/protocol/todex';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { cx } from '@/utils/cx';
import { BACKEND_LABEL_COLORS, backendLabelColor, type BackendConnectionProfile } from '../../session/backendColors';
import { UNPAIRED_TRANSPORT, backendApi, connectionStateLabel, healthLabelOf, isVersionMismatch } from '../../session/helpers';
import type { ConfigSyncPreset } from '../../session/useConfigSync';
import type { BackendLinkStatus, TodeXSession } from '../../session/useTodeXSession';
import { useT } from '../../i18n';
import { DevicePairingPanel } from '../DevicePairingPanel';
import { HistoryEncryptionPanel } from '../HistoryEncryptionPanel';
import { ConfirmDialog } from '../ui/modal';
import { ConfigSyncSettings } from './ConfigSyncSettings';
import { SettingsCard, SettingsEntry, SettingsGroup, SettingsRow, SettingsSubpage } from './SettingsRows';

/** `page` value of the config sync page (backend ids never take this form). */
export const CONFIG_SYNC_PAGE = '__config-sync__';

/** What "sync agent config to a new backend" preselects; SSH hosts are
 * left out because the target rarely holds the matching private keys. */
const AGENT_CONFIG_CATEGORIES: ConfigSyncPreset['categories'] = ['accounts', 'settings', 'mcp', 'skills'];

const STATE_COLORS = { open: 'lime', connecting: 'yellow', error: 'rose', closed: 'neutral', idle: 'neutral' } as const;

function BackendDot({ profile }: { profile: BackendConnectionProfile }) {
  return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: backendLabelColor(profile) }} />;
}

function linkOf(session: TodeXSession, backendId: string): BackendLinkStatus | undefined {
  return session.backendLinkStatus[backendId];
}

/**
 * Every backend profile, each connected on its own. The overview lists them
 * (plus which one serves conversations outside any workspace); opening one
 * shows its connection, device pairing and history encryption on its own
 * page, in place of the overview.
 */
export function BackendConnectionSettings({ session, page, onPageChange, deviceName, pairingAutoStart, historyRecoverySetup, footer, managed = false }: {
  session: TodeXSession;
  /** The backend whose page is open (or `CONFIG_SYNC_PAGE`); null shows the overview. */
  page: string | null;
  onPageChange: (backendId: string | null) => void;
  /** Name this device pairs under. */
  deviceName: string;
  pairingAutoStart: number;
  historyRecoverySetup: boolean;
  /** Extra overview content (platform-specific). */
  footer?: ReactNode;
  /** The platform fixes the backends (a self-hosted web deployment): no
   * adding, removing or editing addresses; pairing works as usual. */
  managed?: boolean;
}) {
  const t = useT();
  // Set by a backend's "sync agent config" card; the overview entry clears it.
  const [syncPreset, setSyncPreset] = useState<ConfigSyncPreset | undefined>();
  if (page === CONFIG_SYNC_PAGE) {
    return <ConfigSyncSettings session={session} preset={syncPreset} onBack={() => onPageChange(null)} />;
  }
  const profile = page ? session.backendConnections.find((item) => item.id === page) : undefined;
  if (profile) {
    return (
      <BackendDetail
        session={session}
        profile={profile}
        deviceName={deviceName}
        pairingAutoStart={pairingAutoStart}
        historyRecoverySetup={historyRecoverySetup}
        managed={managed}
        onBack={() => onPageChange(null)}
        onSyncAgentConfig={(preset) => { setSyncPreset(preset); onPageChange(CONFIG_SYNC_PAGE); }}
      />
    );
  }

  return (
    <>
      <SettingsGroup
        description={t('settings.backendListHint')}
        action={managed ? undefined : (
          <Button size="small" variant="secondary" onClick={() => onPageChange(session.addBackendConnection().id)}>
            {t('settings.addBackend')}
          </Button>
        )}
      >
        <SettingsCard>
          {session.backendConnections.map((item) => {
            const link = linkOf(session, item.id);
            const state = link?.state ?? 'idle';
            const mismatch = isVersionMismatch(__TODEX_BUILD_VERSION__, link?.serverVersion?.version);
            return (
              <SettingsEntry
                key={item.id}
                data-backend-id={item.id}
                leading={<BackendDot profile={item} />}
                title={item.name}
                description={item.tenantId ? `${item.serverUrl} · ${item.tenantId}` : item.serverUrl}
                trailing={(
                  <>
                    {mismatch ? <Chip variant="caption" color="yellow">{t('conn.versionMismatchShort')}</Chip> : null}
                    <Chip variant="caption" color={item.deviceSecret ? 'neutral' : 'yellow'}>
                      {item.deviceSecret ? t('settings.backendPaired') : t('settings.backendUnpaired')}
                    </Chip>
                    <Chip variant="caption" color={STATE_COLORS[state]}>{connectionStateLabel(state)}</Chip>
                  </>
                )}
                onPress={() => onPageChange(item.id)}
              />
            );
          })}
        </SettingsCard>
      </SettingsGroup>
      <SettingsCard>
        <SettingsEntry
          icon={RiArrowLeftRightLine}
          title={t('configSync.title')}
          description={session.backendConnections.length < 2 ? t('configSync.needTwoBackends') : t('configSync.entryHint')}
          isDisabled={session.backendConnections.length < 2}
          onPress={() => { setSyncPreset(undefined); onPageChange(CONFIG_SYNC_PAGE); }}
        />
      </SettingsCard>
      {footer}
    </>
  );
}

/** The backend to copy agent config from: the paired backend other than
 * `targetId` that connected most recently, else the first paired one. */
function agentConfigSource(session: TodeXSession, targetId: string): BackendConnectionProfile | undefined {
  const candidates = session.backendConnections.filter(item => item.id !== targetId && item.deviceSecret);
  const openedAt = (item: BackendConnectionProfile) => linkOf(session, item.id)?.openedAt ?? 0;
  return candidates.reduce<BackendConnectionProfile | undefined>(
    (best, item) => (!best || openedAt(item) > openedAt(best) ? item : best),
    undefined,
  );
}

/**
 * Offers to copy agent config to a paired, connected backend that has no
 * CLI accounts yet (typically a fresh container) from another paired one.
 */
function AgentConfigSyncSuggestion({ session, profile, onSync }: {
  session: TodeXSession;
  profile: BackendConnectionProfile;
  onSync: (preset: ConfigSyncPreset) => void;
}) {
  const t = useT();
  const link = linkOf(session, profile.id);
  const open = link?.state === 'open';
  const paired = Boolean(profile.deviceSecret);
  const source = agentConfigSource(session, profile.id);
  const [empty, setEmpty] = useState<{ key: string; value: boolean } | null>(null);
  const key = `${profile.id}:${link?.epoch ?? 0}`;
  const { serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified } = session.settingsForBackend(profile.id);
  useEffect(() => {
    if (!open || !paired || !source) return;
    let cancelled = false;
    backendApi({ serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified })
      .listAgentProviders()
      .then((response) => {
        const count = Object.values(response.agents ?? {}).reduce((sum, bucket) => sum + (bucket?.providers?.length ?? 0), 0);
        if (!cancelled) setEmpty({ key, value: count === 0 });
      })
      .catch(() => {
        // Only a suggestion: without the list, show nothing.
        if (!cancelled) setEmpty({ key, value: false });
      });
    return () => { cancelled = true; };
  }, [key, open, paired, Boolean(source), serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified]);
  if (!open || !paired || !source || empty?.key !== key || !empty.value) return null;
  return (
    <SettingsCard>
      <SettingsEntry
        icon={RiArrowLeftRightLine}
        title={t('configSync.suggestTitle', { name: source.name })}
        description={t('configSync.suggestHint')}
        onPress={() => onSync({ sourceId: source.id, targetIds: [profile.id], categories: AGENT_CONFIG_CATEGORIES })}
      />
    </SettingsCard>
  );
}

/** One backend's own page: connection, device pairing, history encryption. */
function BackendDetail({ session, profile, deviceName, pairingAutoStart, historyRecoverySetup, managed, onBack, onSyncAgentConfig }: {
  session: TodeXSession;
  profile: BackendConnectionProfile;
  deviceName: string;
  pairingAutoStart: number;
  historyRecoverySetup: boolean;
  managed: boolean;
  onBack: () => void;
  onSyncAgentConfig: (preset: ConfigSyncPreset) => void;
}) {
  const t = useT();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const link = linkOf(session, profile.id);
  const state = link?.state ?? 'idle';
  const connected = state === 'open' || state === 'connecting';
  const serverVersion = link?.serverVersion;
  const mismatch = isVersionMismatch(__TODEX_BUILD_VERSION__, serverVersion?.version);
  const canRemove = session.backendConnections.length > 1;
  // A different backend never keeps the old device key or transport pin.
  const updateServerUrl = (serverUrl: string) => {
    const changed = normalizeServerUrl(profile.serverUrl) !== normalizeServerUrl(serverUrl);
    session.updateBackendConnection(profile.id, { serverUrl, ...(changed ? UNPAIRED_TRANSPORT : {}) });
  };
  return (
    <SettingsSubpage
      title={<span className="flex items-center gap-2"><BackendDot profile={profile} /><span className="truncate">{profile.name}</span></span>}
      description={profile.serverUrl}
      onBack={onBack}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body-regular text-text-secondary">
          {link && state !== 'idle' ? `${healthLabelOf(link.health)} · ` : ''}{connectionStateLabel(state)}
        </p>
        {serverVersion ? (
          <Chip variant="caption" color={mismatch ? 'yellow' : 'neutral'}>
            {serverVersion.name} {serverVersion.version}{profile.tenantId ? ` · ${profile.tenantId}` : ''}{mismatch ? ` · ${t('conn.versionMismatchShort')}` : ''}
          </Chip>
        ) : null}
      </div>
      {link?.error ? <p role="alert" className="text-body-2-regular text-text-error-primary">{link.error}</p> : null}
      <AgentConfigSyncSuggestion session={session} profile={profile} onSync={onSyncAgentConfig} />
      <SettingsGroup label={t('settings.connection')}>
        <SettingsCard>
          <SettingsRow label={t('settings.name')}>
            <Input aria-label={t('settings.name')} name={t('settings.name')} size="small" className="w-64" value={profile.name} onChange={(name) => session.updateBackendConnection(profile.id, { name })} />
          </SettingsRow>
          <SettingsRow label={t('settings.labelColor')} description={t('settings.labelColorHint')}>
            <RadioGroup
              aria-label={t('settings.labelColorAria')}
              orientation="horizontal"
              className="flex flex-wrap items-center gap-2"
              value={backendLabelColor(profile)}
              onChange={(color) => session.updateBackendConnection(profile.id, { labelColor: color })}
            >
              {BACKEND_LABEL_COLORS.map(({ value, label }) => (
                <Radio
                  key={value}
                  value={value}
                  aria-label={label}
                  className={({ isSelected, isFocusVisible }) => cx(
                    'size-6 cursor-pointer rounded-full outline-none transition-shadow duration-150 ease',
                    (isSelected || isFocusVisible) && 'ring-2 ring-border-focus-ring ring-offset-2 ring-offset-background-secondary-default',
                  )}
                  style={{ backgroundColor: value }}
                />
              ))}
            </RadioGroup>
          </SettingsRow>
          {managed ? (
            <SettingsRow label={t('settings.serverUrl')}>
              <span className="w-64 truncate text-body-regular text-text-secondary">{profile.serverUrl}</span>
            </SettingsRow>
          ) : (
            <SettingsRow label={t('settings.serverUrl')} description={<span className="text-status-yellow-text">{t('settings.credentialWarning')}</span>}>
              <Input aria-label={t('settings.serverUrl')} name={t('settings.serverUrl')} size="small" className="w-64" value={profile.serverUrl} onChange={updateServerUrl} />
            </SettingsRow>
          )}
          <SettingsRow label="Tenant">
            <Input aria-label="Tenant" name="Tenant" size="small" className="w-64" value={profile.tenantId} onChange={(tenantId) => session.updateBackendConnection(profile.id, { tenantId })} />
          </SettingsRow>
        </SettingsCard>
        <div className="flex gap-2 px-3">
          <Button size="small" disabled={!profile.serverUrl.trim()} onClick={() => (connected ? session.disconnect(profile.id) : session.connect(profile.id))}>
            {connected ? t('settings.disconnect') : state === 'error' ? t('settings.retry') : t('settings.connect')}
          </Button>
        </div>
      </SettingsGroup>
      <DevicePairingPanel session={session} backendId={profile.id} deviceName={deviceName} autoStartNonce={pairingAutoStart} />
      <HistoryEncryptionPanel history={session.historyEncryption.forBackend(profile.id)} autoStartRecovery={historyRecoverySetup} />
      {managed ? null : (
        <SettingsGroup label={t('settings.removeBackend')}>
          <div className="flex flex-wrap items-center gap-3 px-3">
            <Button size="small" variant="danger" disabled={!canRemove} onClick={() => setConfirmRemove(true)}>{t('settings.removeBackend')}</Button>
            {!canRemove ? <p className="text-body-2-regular text-text-secondary">{t('settings.removeBackendLast')}</p> : null}
          </div>
        </SettingsGroup>
      )}
      <ConfirmDialog
        isOpen={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('settings.removeBackendTitle', { name: profile.name })}
        description={t('settings.removeBackendBody')}
        confirmLabel={t('settings.removeBackend')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          setConfirmRemove(false);
          onBack();
          session.removeBackendConnection(profile.id);
        }}
      />
    </SettingsSubpage>
  );
}

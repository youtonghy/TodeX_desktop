import { useState, type ReactNode } from 'react';
import { Radio, RadioGroup } from 'react-aria-components';
import { normalizeServerUrl } from '@todex/protocol/todex';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { cx } from '@/utils/cx';
import { BACKEND_LABEL_COLORS, backendLabelColor, type BackendConnectionProfile } from '../../session/backendColors';
import { UNPAIRED_TRANSPORT, connectionStateLabel, healthLabelOf, isVersionMismatch } from '../../session/helpers';
import type { BackendLinkStatus, TodeXSession } from '../../session/useTodeXSession';
import { useT } from '../../i18n';
import { DevicePairingPanel } from '../DevicePairingPanel';
import { HistoryEncryptionPanel } from '../HistoryEncryptionPanel';
import { ConfirmDialog } from '../ui/modal';
import { SettingsCard, SettingsEntry, SettingsGroup, SettingsRow, SettingsSubpage } from './SettingsRows';

/** Compact select trigger for the right side of a settings row. */
const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';

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
  /** The backend whose page is open; null shows the overview. */
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
                    {item.id === session.noWorkspaceBackendId ? <Chip variant="caption" color="neutral">{t('settings.noWorkspaceTag')}</Chip> : null}
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
        <SettingsRow label={t('settings.noWorkspaceBackend')} description={t('settings.noWorkspaceBackendHint')}>
          <Select
            aria-label={t('settings.noWorkspaceBackend')}
            selectedKey={session.noWorkspaceBackendId}
            triggerClassName={ROW_SELECT_TRIGGER}
            onSelectionChange={(key) => { if (typeof key === 'string') session.setNoWorkspaceBackendId(key); }}
          >
            {session.backendConnections.map((item) => (
              <SelectItem key={item.id} id={item.id} textValue={item.name}>{item.name}</SelectItem>
            ))}
          </Select>
        </SettingsRow>
      </SettingsCard>
      {footer}
    </>
  );
}

/** One backend's own page: connection, device pairing, history encryption. */
function BackendDetail({ session, profile, deviceName, pairingAutoStart, historyRecoverySetup, managed, onBack }: {
  session: TodeXSession;
  profile: BackendConnectionProfile;
  deviceName: string;
  pairingAutoStart: number;
  historyRecoverySetup: boolean;
  managed: boolean;
  onBack: () => void;
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

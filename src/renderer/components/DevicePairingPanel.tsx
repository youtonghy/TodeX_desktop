import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Chip, Spinner } from '@heroui/react';
import {
  DevicePairingRetryableError,
  PAIRING_POLL_INTERVAL_MS,
  beginDevicePairing,
  nextPairingPollDelayMs,
  type DevicePairingRequest,
} from '../session/devicePairing';
import { deviceIdentityFromSecret, generateDeviceIdentity } from '@todex/protocol/deviceAuth';
import { transportFingerprint } from '@todex/protocol/secureChannel';
import { normalizeServerUrl, type BackendConnectionProfile } from '@todex/protocol/todex';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { useNoticeToast } from './NoticeToast';

type Props = { session: TodeXSession; deviceName: string; autoStartNonce?: number };
type Phase = 'idle' | 'requesting' | 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'error';
type Attempt = {
  profileId: string;
  serverUrl: string;
  settingsServerUrl: string;
  controller: AbortController;
  request?: DevicePairingRequest;
  pollTimer?: ReturnType<typeof setTimeout>;
  expiryTimer?: ReturnType<typeof setTimeout>;
  clockTimer?: ReturnType<typeof setInterval>;
};

type TransportStatus = { protocol: string; fingerprint: string; state: 'verified' | 'unverified' | 'unpaired' };

/** Read-only view of the profile's pinned transport; only device pairing writes it. */
function transportStatus(profile: BackendConnectionProfile): TransportStatus {
  const key = profile.encryptionPublicKey.trim();
  const pinned = profile.encryptionProtocol !== 'none' || Boolean(key);
  if (!pinned) return { protocol: 'none', fingerprint: 'none', state: 'unpaired' };
  let fingerprint = '-';
  if (profile.encryptionProtocol !== 'none' && key) {
    try {
      fingerprint = transportFingerprint(profile.encryptionProtocol, key);
    } catch {
      // An unusable key is refused at connect time; show it as missing here.
    }
  }
  return { protocol: profile.encryptionProtocol, fingerprint, state: profile.transportVerified ? 'verified' : 'unverified' };
}

/** Keep every asynchronous response attached to the profile that requested it.
 * Approval writes the device secret and the verified transport pin in one
 * profile update; nothing is persisted before that. */
export function DevicePairingPanel({ session, deviceName, autoStartNonce = 0 }: Props) {
  const t = useT();
  const profile = session.backendConnections.find(item => item.id === session.activeBackendConnectionId);
  const latest = useRef(session);
  latest.current = session;
  const active = useRef<Attempt | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [verificationCode, setVerificationCode] = useState('');
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  // A device key generated for a profile that has none is kept only in memory
  // until approval, so retries for the same backend enroll the same key.
  const pendingDeviceSecret = useRef<{ scope: string; secret: string } | null>(null);

  const dispose = (attempt: Attempt, cancel: boolean) => {
    if (active.current === attempt) active.current = null;
    attempt.controller.abort();
    clearTimeout(attempt.pollTimer);
    clearTimeout(attempt.expiryTimer);
    clearInterval(attempt.clockTimer);
    if (cancel && attempt.request) void attempt.request.cancel().catch(() => {});
  };

  useLayoutEffect(() => {
    setPhase('idle');
    setVerificationCode('');
    setFingerprint('');
    setError('');
    return () => { if (active.current) dispose(active.current, true); };
  }, [profile?.id, profile?.serverUrl, session.settings.serverUrl]);

  // A re-pair request (e.g. from a refused connection) bumps the nonce.
  const lastAutoStart = useRef(autoStartNonce);
  useEffect(() => {
    if (autoStartNonce === lastAutoStart.current) return;
    lastAutoStart.current = autoStartNonce;
    void start();
  }, [autoStartNonce]);

  const isCurrent = (attempt: Attempt) => {
    const current = latest.current;
    return active.current === attempt && !attempt.controller.signal.aborted
      && current.activeBackendConnectionId === attempt.profileId
      && current.settings.serverUrl === attempt.settingsServerUrl
      && current.backendConnections.some(item => item.id === attempt.profileId && item.serverUrl === attempt.serverUrl);
  };

  const start = async () => {
    if (!profile || active.current) return;
    // Re-pairing the same backend reuses its device key (same deviceId and
    // history-key recipient); changing the server URL already cleared it.
    const scope = `${profile.id}\n${normalizeServerUrl(profile.serverUrl)}`;
    let deviceSecret = latest.current.backendConnections.find(item => item.id === profile.id)?.deviceSecret ?? '';
    if (!deviceIdentityFromSecret(deviceSecret)) {
      if (pendingDeviceSecret.current?.scope !== scope) {
        pendingDeviceSecret.current = { scope, secret: generateDeviceIdentity().secretKey };
      }
      deviceSecret = pendingDeviceSecret.current.secret;
    }
    const device = deviceIdentityFromSecret(deviceSecret)!;
    const attempt: Attempt = {
      profileId: profile.id, serverUrl: profile.serverUrl,
      settingsServerUrl: session.settings.serverUrl, controller: new AbortController(),
    };
    active.current = attempt;
    setPhase('requesting');
    setError('');
    setVerificationCode('');
    setFingerprint('');
    try {
      const request = await beginDevicePairing(attempt.serverUrl, deviceName, device, attempt.controller.signal);
      attempt.request = request;
      if (!isCurrent(attempt)) { dispose(attempt, true); return; }
      const expire = () => {
        if (!isCurrent(attempt)) return;
        dispose(attempt, true);
        setPhase('expired');
      };
      if (request.expiresAt <= Date.now()) { expire(); return; }
      setVerificationCode(request.verificationCode);
      setFingerprint(request.transportFingerprint);
      setRemaining(Math.ceil((request.expiresAt - Date.now()) / 1000));
      setPhase('pending');
      attempt.clockTimer = setInterval(() => {
        if (isCurrent(attempt)) setRemaining(Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)));
      }, 1000);
      attempt.expiryTimer = setTimeout(expire, request.expiresAt - Date.now());
      // Transient failures (429, 5xx, network) back off and keep polling
      // until the request expires; anything else ends the attempt.
      let pollDelay = PAIRING_POLL_INTERVAL_MS;
      const schedulePoll = () => { attempt.pollTimer = setTimeout(() => { void poll(); }, pollDelay); };
      const poll = async () => {
        if (!isCurrent(attempt)) return;
        try {
          const result = await request.poll(attempt.controller.signal);
          if (!isCurrent(attempt)) return;
          if (request.expiresAt <= Date.now()) { expire(); return; }
          if (result.status === 'pending') {
            // Schedule only after the previous request settles; never overlap polls.
            pollDelay = PAIRING_POLL_INTERVAL_MS;
            schedulePoll();
            return;
          }
          if (result.status === 'approved') {
            // The approval verified this device and the transport key the
            // code authenticated: pin both in one update, then connect.
            const current = latest.current;
            if (!(current.activeBackendConnectionId === attempt.profileId
              && current.backendConnections.some(item => item.id === attempt.profileId && item.serverUrl === attempt.serverUrl)
              && current.settings.serverUrl === attempt.serverUrl)) {
              return;
            }
            current.onDevicePairingApproved(attempt.profileId, {
              deviceSecret,
              encryptionProtocol: result.pin.encryptionProtocol,
              encryptionPublicKey: result.pin.encryptionPublicKey,
              transportVerified: true,
            });
            if (pendingDeviceSecret.current?.scope === scope) pendingDeviceSecret.current = null;
          }
          dispose(attempt, false);
          setPhase(result.status);
        } catch (cause) {
          if (!isCurrent(attempt)) return;
          if (cause instanceof DevicePairingRetryableError && request.expiresAt > Date.now()) {
            pollDelay = nextPairingPollDelayMs(pollDelay, cause);
            schedulePoll();
            return;
          }
          dispose(attempt, true);
          setError(cause instanceof Error ? cause.message : t('pair.verifyFailed'));
          setPhase('error');
        }
      };
      schedulePoll();
    } catch (cause) {
      if (!isCurrent(attempt)) return;
      dispose(attempt, true);
      setError(cause instanceof Error ? cause.message : t('pair.requestFailed'));
      setPhase('error');
    }
  };

  const waiting = phase === 'requesting' || phase === 'pending';
  const status = profile ? transportStatus(profile) : null;
  const paired = Boolean(deviceIdentityFromSecret(profile?.deviceSecret)) || status?.state !== 'unpaired';
  const noticeScope = `${profile?.id}:${profile?.serverUrl}:${session.settings.serverUrl}`;
  const phaseMessage = phase === 'approved' ? t('pair.approved')
    : phase === 'rejected' ? t('pair.rejected')
    : phase === 'expired' ? t('pair.expired')
    : phase === 'cancelled' ? t('pair.cancelled')
    : phase === 'error' ? error : null;
  useNoticeToast(phaseMessage, {
    variant: phase === 'approved' ? 'success' : phase === 'error' ? 'danger' : phase === 'cancelled' ? 'info' : 'warning',
    scope: noticeScope,
  });
  return (
    <section aria-label={t('pair.sectionLabel')} className="border-separator flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h4 className="text-sm font-semibold">{t('pair.title')}</h4>
        <p className="text-muted mt-1 text-xs">{t('pair.hint')}</p>
      </div>
      {status ? (
        <dl aria-label={t('pair.transportStatus')} className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">{t('pair.transportProtocol')}</dt>
          <dd className="font-mono">{status.protocol}</dd>
          <dt className="text-muted">{t('pair.transportFingerprint')}</dt>
          <dd className="font-mono">{status.fingerprint}</dd>
          <dt className="text-muted">{t('pair.transportState')}</dt>
          <dd>
            <Chip size="sm" variant="soft" color={status.state === 'verified' ? 'success' : status.state === 'unverified' ? 'warning' : 'default'}>
              {status.state === 'verified' ? t('pair.transportVerified') : status.state === 'unverified' ? t('pair.transportUnverified') : t('pair.transportUnpaired')}
            </Chip>
          </dd>
        </dl>
      ) : null}
      {phase === 'pending' ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted text-xs">{t('pair.code')}</p>
          <output aria-label={t('pair.code')} className="font-mono text-2xl font-semibold tracking-widest">{verificationCode}</output>
          <p className="text-muted text-xs">{t('pair.codeFingerprint')} <span className="font-mono">{fingerprint}</span></p>
          <p role="status" className="text-muted flex items-center gap-2 text-sm"><Spinner size="sm" />{t('pair.waiting')}</p>
          <p className="text-muted text-xs">{t('pair.remaining', { seconds: remaining })}</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        {phase !== 'pending' ? <Button size="sm" variant="secondary" isPending={phase === 'requesting'} isDisabled={!profile?.serverUrl.trim()} onPress={() => { void start(); }}>
          {({ isPending }) => <>{isPending ? <Spinner size="sm" color="current" /> : null}{isPending ? t('pair.requesting') : phase === 'idle' ? (paired ? t('pair.repair') : t('pair.title')) : t('pair.reapply')}</>}
        </Button> : null}
        {waiting ? <Button size="sm" variant="tertiary" onPress={() => {
          if (active.current) dispose(active.current, true);
          setVerificationCode('');
          setPhase('cancelled');
        }}>{t('pair.cancel')}</Button> : null}
      </div>
    </section>
  );
}

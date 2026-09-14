import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Spinner } from '@heroui/react';
import { beginDevicePairing, type DevicePairingRequest } from '../session/devicePairing';
import { deviceIdentityFromSecret, generateDeviceIdentity } from '@todex/protocol/deviceAuth';
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

/** Keep every asynchronous response attached to the profile that requested it. */
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
    setError('');
    return () => { if (active.current) dispose(active.current, true); };
  }, [profile?.id, profile?.serverUrl, session.settings.serverUrl]);

  // Pairing-link import bumps the nonce; auto-enroll when this profile has no
  // enrolled device yet.
  const lastAutoStart = useRef(autoStartNonce);
  useEffect(() => {
    if (autoStartNonce === lastAutoStart.current) return;
    lastAutoStart.current = autoStartNonce;
    if (!deviceIdentityFromSecret(profile?.deviceSecret)) void start();
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
    // Persist a fresh device identity up front so retries enroll the same key.
    const current = latest.current;
    let deviceSecret = current.backendConnections.find(item => item.id === profile.id)?.deviceSecret ?? '';
    if (!deviceIdentityFromSecret(deviceSecret)) {
      deviceSecret = generateDeviceIdentity().secretKey;
      current.updateBackendConnection(profile.id, { deviceSecret });
      current.setSettings(settings => (
        current.activeBackendConnectionId === profile.id ? { ...settings, deviceSecret } : settings
      ));
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
      setRemaining(Math.ceil((request.expiresAt - Date.now()) / 1000));
      setPhase('pending');
      attempt.clockTimer = setInterval(() => {
        if (isCurrent(attempt)) setRemaining(Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000)));
      }, 1000);
      attempt.expiryTimer = setTimeout(expire, request.expiresAt - Date.now());
      const poll = async () => {
        if (!isCurrent(attempt)) return;
        try {
          const result = await request.poll(attempt.controller.signal);
          if (!isCurrent(attempt)) return;
          if (request.expiresAt <= Date.now()) { expire(); return; }
          if (result.status === 'pending') {
            // Schedule only after the previous request settles; never overlap polls.
            attempt.pollTimer = setTimeout(() => { void poll(); }, 2000);
            return;
          }
          if (result.status === 'approved') {
            // The device key was persisted when pairing started; approval only
            // confirms the backend registered the matching deviceId.
            const current = latest.current;
            if (!(current.activeBackendConnectionId === attempt.profileId
              && current.backendConnections.some(item => item.id === attempt.profileId && item.serverUrl === attempt.serverUrl)
              && current.settings.serverUrl === attempt.serverUrl)) {
              return;
            }
            current.onDevicePairingApproved?.();
          }
          dispose(attempt, false);
          setPhase(result.status);
        } catch (cause) {
          if (!isCurrent(attempt)) return;
          dispose(attempt, true);
          setError(cause instanceof Error ? cause.message : t('pair.verifyFailed'));
          setPhase('error');
        }
      };
      attempt.pollTimer = setTimeout(() => { void poll(); }, 2000);
    } catch (cause) {
      if (!isCurrent(attempt)) return;
      dispose(attempt, true);
      setError(cause instanceof Error ? cause.message : t('pair.requestFailed'));
      setPhase('error');
    }
  };

  const waiting = phase === 'requesting' || phase === 'pending';
  const missingPublicKey = profile?.encryptionProtocol !== 'none' && !profile?.encryptionPublicKey?.trim();
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
  useNoticeToast(missingPublicKey ? t('pair.missingPublicKey') : null, {
    description: t('pair.missingPublicKeyDesc'),
    scope: noticeScope,
  });
  return (
    <section aria-label={t('pair.sectionLabel')} className="border-separator flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h4 className="text-sm font-semibold">{t('pair.title')}</h4>
        <p className="text-muted mt-1 text-xs">{t('pair.hint')}</p>
      </div>
      {phase === 'pending' ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted text-xs">{t('pair.code')}</p>
          <output aria-label={t('pair.code')} className="font-mono text-2xl font-semibold tracking-widest">{verificationCode}</output>
          <p role="status" className="text-muted flex items-center gap-2 text-sm"><Spinner size="sm" />{t('pair.waiting')}</p>
          <p className="text-muted text-xs">{t('pair.remaining', { seconds: remaining })}</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        {phase !== 'pending' ? <Button size="sm" variant="secondary" isPending={phase === 'requesting'} isDisabled={!profile?.serverUrl.trim()} onPress={() => { void start(); }}>
          {({ isPending }) => <>{isPending ? <Spinner size="sm" color="current" /> : null}{isPending ? t('pair.requesting') : phase === 'idle' ? t('pair.title') : t('pair.reapply')}</>}
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

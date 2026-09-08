import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Spinner } from '@heroui/react';
import { beginDevicePairing, type DevicePairingRequest } from '../session/devicePairing';
import type { TodeXSession } from '../session/useTodeXSession';

type Props = { session: TodeXSession; deviceName: string };
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
export function DevicePairingPanel({ session, deviceName }: Props) {
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

  const isCurrent = (attempt: Attempt) => {
    const current = latest.current;
    return active.current === attempt && !attempt.controller.signal.aborted
      && current.activeBackendConnectionId === attempt.profileId
      && current.settings.serverUrl === attempt.settingsServerUrl
      && current.backendConnections.some(item => item.id === attempt.profileId && item.serverUrl === attempt.serverUrl);
  };

  const start = async () => {
    if (!profile || active.current) return;
    const attempt: Attempt = {
      profileId: profile.id, serverUrl: profile.serverUrl,
      settingsServerUrl: session.settings.serverUrl, controller: new AbortController(),
    };
    active.current = attempt;
    setPhase('requesting');
    setError('');
    setVerificationCode('');
    try {
      const request = await beginDevicePairing(attempt.serverUrl, deviceName, attempt.controller.signal);
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
            if (!result.authToken?.trim()) throw new Error('后端批准结果缺少连接凭据，请重新申请。');
            const token = result.authToken;
            const current = latest.current;
            current.updateBackendConnection(attempt.profileId, { authToken: token });
            current.setSettings(settings => (
              latest.current.activeBackendConnectionId === attempt.profileId
              && latest.current.backendConnections.some(item => item.id === attempt.profileId && item.serverUrl === attempt.serverUrl)
              && settings.serverUrl === attempt.serverUrl
                ? { ...settings, authToken: token } : settings
            ));
          }
          dispose(attempt, false);
          setPhase(result.status);
        } catch (cause) {
          if (!isCurrent(attempt)) return;
          dispose(attempt, true);
          setError(cause instanceof Error ? cause.message : '设备验证失败，请重新申请。');
          setPhase('error');
        }
      };
      attempt.pollTimer = setTimeout(() => { void poll(); }, 2000);
    } catch (cause) {
      if (!isCurrent(attempt)) return;
      dispose(attempt, true);
      setError(cause instanceof Error ? cause.message : '无法申请设备验证，请检查后端地址。');
      setPhase('error');
    }
  };

  const waiting = phase === 'requesting' || phase === 'pending';
  const missingPublicKey = profile?.encryptionProtocol !== 'none' && !profile?.encryptionPublicKey?.trim();
  return (
    <section aria-label="设备验证" className="border-separator flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h4 className="text-sm font-semibold">设备验证</h4>
        <p className="text-muted mt-1 text-xs">申请后，请在后端核对同一个随机核对码，并批准此设备。</p>
      </div>
      {phase === 'pending' ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted text-xs">随机核对码</p>
          <output aria-label="随机核对码" className="font-mono text-2xl font-semibold tracking-widest">{verificationCode}</output>
          <p role="status" className="text-muted flex items-center gap-2 text-sm"><Spinner size="sm" />等待后端批准</p>
          <p className="text-muted text-xs">剩余 {remaining} 秒</p>
        </div>
      ) : null}
      <div aria-live="polite" className="text-sm">
        {phase === 'approved' ? <p className="text-success">已批准，可连接。连接凭据已保存到此后端。</p> : null}
        {phase === 'rejected' ? <p className="text-warning">后端已拒绝申请。请与后端管理员核对后重新申请。</p> : null}
        {phase === 'expired' ? <p className="text-warning">申请已过期，请重新申请设备验证。</p> : null}
        {phase === 'cancelled' ? <p className="text-muted">已取消本次设备验证。</p> : null}
        {phase === 'error' ? <p className="text-danger" role="alert">{error}</p> : null}
      </div>
      {missingPublicKey ? <p className="text-warning text-xs">已启用传输加密，但缺少加密公钥。设备验证只保存连接凭据；仍需通过下方二维码或粘贴配对内容导入公钥，再使用“连接”按钮。</p> : null}
      <div className="flex gap-2">
        {phase !== 'pending' ? <Button size="sm" variant="secondary" isPending={phase === 'requesting'} isDisabled={!profile?.serverUrl.trim()} onPress={() => { void start(); }}>
          {({ isPending }) => <>{isPending ? <Spinner size="sm" color="current" /> : null}{isPending ? '正在申请' : phase === 'idle' ? '设备验证' : '重新申请'}</>}
        </Button> : null}
        {waiting ? <Button size="sm" variant="tertiary" onPress={() => {
          if (active.current) dispose(active.current, true);
          setVerificationCode('');
          setPhase('cancelled');
        }}>取消验证</Button> : null}
      </div>
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiRefreshLine, RiStarLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { isLoopbackHostname } from '@todex/protocol/loopback';
import type {
  LocalAdminStatus,
  LocalBackendConfig,
  LocalBackendDiscovery,
  LocalPairedDevice,
  LocalPairingRequest,
  PairingEncryption,
} from '../../../preload/localBackendTypes';
import type { TodeXSession } from '../../session/useTodeXSession';
import {
  LOCAL_BACKEND_PREFS_KEY,
  NATIVE_INSTANCE,
  ensureManagedConnection,
  managedProfile,
  nativeIpcCandidate,
  switchToNativeIpc,
  type LocalBackendPrefs,
} from '../../session/localPairing';
import { useT } from '../../i18n';
import { loadJson, saveJson } from '../../lib/storage';
import { RecoveryQrCode } from '../HistoryEncryptionPanel';
import { ConfirmDialog } from '../ui/modal';
import { CodeBlock } from '../ui/code-block';
import { ProgressBar } from '../ui/progress-bar';
import { Spinner } from '../ui/spinner';
import { toast } from '../ui/toast';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow, SettingsValueField } from './SettingsRows';

const ADMIN_POLL_MS = 3000;
const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';
const ENCRYPTIONS: PairingEncryption[] = ['ml-kem-768', 'x25519', 'none'];

const STATE_LABELS = {
  notInstalled: 'localBackend.state.notInstalled',
  stopped: 'localBackend.state.stopped',
  running: 'localBackend.state.running',
  connected: 'localBackend.state.connected',
} as const;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatTime(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleString() : '-';
}

/** "Deploy this machine's backend": install the build matching this desktop,
 * run it with the shared data directory, pair over IPC and connect; then the
 * backend TUI's settings, remote access and device approval as a page. TodeX
 * containers sharing their socket get the same management cards. */
export function LocalBackendSettings({ session, deviceName }: { session: TodeXSession; deviceName: string }) {
  const t = useT();
  const api = window.todexDesktop.localBackend;
  const [discovery, setDiscovery] = useState<LocalBackendDiscovery | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [log, setLog] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<LocalBackendPrefs>({});
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const refresh = useCallback(async () => {
    try {
      setDiscovery(await api.discover());
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    void loadJson<LocalBackendPrefs>(LOCAL_BACKEND_PREFS_KEY, {}).then(setPrefs);
    return api.onProgress(({ received, total }) => setProgress({ received, total }));
  }, [api, refresh]);

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
      setProgress(null);
      await refresh();
    }
  };

  const connectInstance = (instance: string, name: string, repair = false) => ensureManagedConnection(sessionRef.current, {
    instance, name, deviceName, repair,
  });

  const native = discovery?.native;
  const daemonRunning = native?.daemon?.running === true;
  const versionMismatch = Boolean(native?.expectedVersion && native.binary?.version && native.binary.version !== native.expectedVersion);
  const profile = managedProfile(session.backendConnections, NATIVE_INSTANCE);
  const link = profile ? session.backendLinkStatus[profile.id] : undefined;
  // A loopback TCP connection to this daemon, which also serves IPC.
  const ipcCandidate = native?.daemon ? nativeIpcCandidate(
    session.backendConnections,
    { running: daemonRunning, port: native.daemon.port, ipcPath: native.ipcPath },
    (id) => session.backendLinkStatus[id]?.state === 'open',
  ) : undefined;
  // An older daemon runs but cannot be paired or managed over IPC.
  const ipcBlocked = daemonRunning && native?.ipcSupported === false;

  const deploy = () => run('deploy', async () => {
    if (!native?.binary || versionMismatch && !daemonRunning) await api.install();
    if (!daemonRunning) await api.start();
    await connectInstance(NATIVE_INSTANCE, t('localBackend.profileName'));
    toast.success(t('localBackend.deployed'));
  });

  const updatePrefs = (patch: LocalBackendPrefs) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void saveJson(LOCAL_BACKEND_PREFS_KEY, next);
  };

  if (!discovery) {
    return error
      ? <p role="alert" className="text-body-2-regular text-text-error-primary">{error}</p>
      : <div className="flex justify-center py-8"><Spinner /></div>;
  }

  const state: keyof typeof STATE_LABELS = !native?.binary ? 'notInstalled' : !daemonRunning ? 'stopped' : link?.state === 'open' ? 'connected' : 'running';
  const stateColor = state === 'connected' ? 'lime' : state === 'running' ? 'blue' : 'neutral';

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        label={t('localBackend.thisMachine')}
        description={t('localBackend.thisMachineHint')}
        action={<Button size="small" variant="secondary" leadingIcon={RiRefreshLine} disabled={busy !== null} onClick={() => { setError(''); void refresh(); }}>{t('localBackend.refresh')}</Button>}
      >
        <SettingsCard>
          <SettingsRow label={t('localBackend.status')}>
            <Chip variant="caption" color={stateColor}>{t(STATE_LABELS[state])}</Chip>
          </SettingsRow>
          <SettingsRow label={t('localBackend.version')} description={native?.binary?.path}>
            <SettingsValueField mono>{native?.binary?.version ?? '-'}</SettingsValueField>
          </SettingsRow>
          {daemonRunning ? (
            <SettingsRow label={t('localBackend.pid')} description={native?.daemon?.startedAt ? t('localBackend.startedAt', { time: new Date(native.daemon.startedAt).toLocaleString() }) : undefined}>
              <SettingsValueField mono>{native?.daemon?.pid ?? '-'}</SettingsValueField>
            </SettingsRow>
          ) : null}
          <SettingsRow label={t('localBackend.dataDir')}>
            <SettingsValueField mono title={native?.dataDir}>{native?.dataDir}</SettingsValueField>
          </SettingsRow>
          {native?.ipcPath ? (
            <SettingsRow label={t('localBackend.ipcPath')}>
              <SettingsValueField mono title={native.ipcPath}>{native.ipcPath}</SettingsValueField>
            </SettingsRow>
          ) : null}
          {native?.binary && !native.ipcSupported ? (
            <SettingsNote tone="warning">{t('localBackend.binaryTooOld', { version: native.binary.version ?? '-', path: native.binary.path })}</SettingsNote>
          ) : null}
          {ipcCandidate ? (
            <SettingsNote>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('localBackend.ipcSuggestBody', { name: ipcCandidate.name, url: ipcCandidate.serverUrl })}</span>
                <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('switchIpc', async () => {
                  await switchToNativeIpc(sessionRef.current, ipcCandidate.id, deviceName);
                  toast.success(t('localBackend.switchedToIpc'));
                })}>{t('localBackend.switchToIpc')}</Button>
              </div>
            </SettingsNote>
          ) : null}
          {!native?.platformSupported && !native?.binary ? <SettingsNote tone="warning">{t('localBackend.unsupportedPlatform')}</SettingsNote> : null}
          {versionMismatch ? (
            <SettingsNote tone="warning">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('localBackend.versionMismatch', { running: native?.binary?.version ?? '-', expected: native?.expectedVersion ?? '-' })}</span>
                <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('switch', () => api.switchVersion())}>{t('localBackend.switchVersion')}</Button>
              </div>
            </SettingsNote>
          ) : null}
          {native?.adminError && daemonRunning ? <SettingsNote tone="warning">{t('localBackend.ipcUnavailable', { error: native.adminError })}</SettingsNote> : null}
          {busy === 'deploy' && progress ? (
            <SettingsNote>
              <ProgressBar value={progress.total ? Math.round((progress.received / progress.total) * 100) : undefined} aria-label={t('localBackend.downloading')} />
            </SettingsNote>
          ) : null}
          {error ? <SettingsNote tone="danger" role="alert">{error}</SettingsNote> : null}
        </SettingsCard>
        <div className="flex flex-wrap gap-2 px-3">
          {state !== 'connected' && !ipcBlocked ? (
            <Button size="small" disabled={busy !== null || (!native?.binary && !native?.platformSupported)} onClick={deploy}>
              {busy === 'deploy' ? t('localBackend.deploying') : state === 'notInstalled' ? t('localBackend.deploy') : t('localBackend.startAndConnect')}
            </Button>
          ) : null}
          {daemonRunning ? (
            <>
              <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('restart', () => api.restart())}>{t('localBackend.restart')}</Button>
              <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('stop', () => api.stop())}>{t('localBackend.stop')}</Button>
              {!ipcBlocked ? <Button size="small" variant="secondary" disabled={busy !== null} onClick={() => void run('repair', () => connectInstance(NATIVE_INSTANCE, t('localBackend.profileName'), true))}>{t('localBackend.repair')}</Button> : null}
            </>
          ) : null}
          {native?.binary ? (
            <Button size="small" variant="secondary" onClick={() => void api.logTail().then(setLog, (cause) => setError(errorText(cause)))}>{t('localBackend.showLog')}</Button>
          ) : null}
        </div>
        {log !== null ? <CodeBlock code={log || t('localBackend.logEmpty')} language="plaintext" /> : null}
      </SettingsGroup>

      {native?.binary ? (
        <SettingsGroup label={t('localBackend.startup')}>
          <SettingsCard>
            <SettingsRow label={t('localBackend.autostart')} description={t('localBackend.autostartHint')}>
              <Switch
                size="sm"
                aria-label={t('localBackend.autostart')}
                isSelected={native.autostart === true}
                isDisabled={busy !== null || native.autostart === null}
                onChange={(enabled) => void run('autostart', () => api.setAutostart(enabled))}
              />
            </SettingsRow>
            <SettingsRow label={t('localBackend.stopOnQuit')} description={t('localBackend.stopOnQuitHint')}>
              <Switch size="sm" aria-label={t('localBackend.stopOnQuit')} isSelected={prefs.stopOnQuit === true} onChange={(stopOnQuit) => updatePrefs({ stopOnQuit })} />
            </SettingsRow>
            <SettingsRow label={t('localBackend.suggestIpc')} description={t('localBackend.suggestIpcHint')}>
              <Switch size="sm" aria-label={t('localBackend.suggestIpc')} isSelected={prefs.suggestIpc !== false} onChange={(suggestIpc) => updatePrefs({ suggestIpc })} />
            </SettingsRow>
          </SettingsCard>
        </SettingsGroup>
      ) : null}

      {daemonRunning && native?.admin ? (
        <InstanceAdmin
          instance={NATIVE_INSTANCE}
          status={native.admin}
          canRestart
          onRestart={() => run('restart', () => api.restart())}
          onRepair={() => connectInstance(NATIVE_INSTANCE, t('localBackend.profileName'), true)}
        />
      ) : null}

      {discovery.containers.length ? (
        <SettingsGroup label={t('localBackend.containers')} description={t('localBackend.containersHint')}>
          {discovery.containers.map((container) => (
            <ContainerCard
              key={container.id}
              session={session}
              container={container}
              busy={busy !== null}
              onConnect={() => void run(`connect-${container.id}`, () => connectInstance(container.id, t('localBackend.containerProfileName', { name: container.name })))}
              onRepair={() => connectInstance(container.id, t('localBackend.containerProfileName', { name: container.name }), true)}
            />
          ))}
        </SettingsGroup>
      ) : null}
    </div>
  );
}

function ContainerCard({ session, container, busy, onConnect, onRepair }: {
  session: TodeXSession;
  container: LocalBackendDiscovery['containers'][number];
  busy: boolean;
  onConnect: () => void;
  onRepair: () => Promise<unknown>;
}) {
  const t = useT();
  const profile = container.socketPath ? managedProfile(session.backendConnections, container.id) : undefined;
  const connected = profile ? session.backendLinkStatus[profile.id]?.state === 'open' : false;
  return (
    <div className="flex flex-col gap-3">
      <SettingsCard>
        <SettingsRow label={container.name} description={container.socketPath ?? t('localBackend.containerNoSocket')}>
          {container.admin ? <Chip variant="caption" color={connected ? 'lime' : 'blue'}>{connected ? t('localBackend.state.connected') : container.admin.version}</Chip> : null}
          {container.socketPath && !connected ? <Button size="small" disabled={busy} onClick={onConnect}>{t('localBackend.connect')}</Button> : null}
        </SettingsRow>
        {container.adminError ? <SettingsNote tone="warning">{t('localBackend.containerSocketRefused', { error: container.adminError })}</SettingsNote> : null}
      </SettingsCard>
      {container.admin ? <InstanceAdmin instance={container.id} status={container.admin} canRestart={false} onRepair={onRepair} /> : null}
    </div>
  );
}

/** The TUI's settings, pairing QR, device approval and resets for one instance. */
function InstanceAdmin({ instance, status: initialStatus, canRestart, onRestart, onRepair }: {
  instance: string;
  status: LocalAdminStatus;
  canRestart: boolean;
  onRestart?: () => Promise<unknown>;
  onRepair: () => Promise<unknown>;
}) {
  const t = useT();
  const api = window.todexDesktop.localBackend;
  const [status, setStatus] = useState(initialStatus);
  const [config, setConfig] = useState<LocalBackendConfig | null>(null);
  const [draft, setDraft] = useState<{ host: string; port: string }>({ host: '', port: '' });
  const [requests, setRequests] = useState<LocalPairingRequest[]>([]);
  const [devices, setDevices] = useState<LocalPairedDevice[]>([]);
  const [error, setError] = useState('');
  const [confirmHost, setConfirmHost] = useState(false);
  const [confirmReset, setConfirmReset] = useState<'devices' | 'encryption' | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<LocalPairedDevice | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextStatus, nextConfig, nextRequests, nextDevices] = await Promise.all([
        api.status(instance), api.getConfig(instance), api.pairingRequests(instance), api.devices(instance),
      ]);
      setStatus(nextStatus);
      setConfig((previous) => {
        if (!previous || previous.host !== nextConfig.host || previous.port !== nextConfig.port) {
          setDraft({ host: nextConfig.host, port: String(nextConfig.port) });
        }
        return nextConfig;
      });
      setRequests(nextRequests);
      setDevices(nextDevices);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [api, instance]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), ADMIN_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (task: () => Promise<unknown>) => {
    try {
      await task();
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
    await load();
  };

  const saveConfig = (patch: Partial<LocalBackendConfig>) => act(async () => {
    setConfig(await api.setConfig(instance, patch));
  });

  const saveListen = () => {
    const port = Number(draft.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t('localBackend.invalidPort'));
      return;
    }
    const host = draft.host.trim();
    if (!isLoopbackHostname(host) && (!config || isLoopbackHostname(config.host))) {
      setConfirmHost(true);
      return;
    }
    void saveConfig({ host, port });
  };

  const addRoot = async () => {
    const path = await window.todexDesktop.dialog.openDirectory();
    if (path && config) await saveConfig({ workspaceRoots: [...config.workspaceRoots, path] });
  };

  const editable = config?.editable === true;
  const remote = !isLoopbackHostname(status.listen.host);
  const listenDirty = config ? draft.host.trim() !== config.host || draft.port !== String(config.port) : false;

  return (
    <>
      <SettingsGroup label={t('localBackend.listen')} description={editable ? t('localBackend.listenHint') : t('localBackend.managedByImage')}>
        <SettingsCard>
          <SettingsRow label={t('localBackend.host')} description={t('localBackend.hostHint')}>
            <Input aria-label={t('localBackend.host')} size="small" className="w-44" isDisabled={!editable} value={draft.host} onChange={(host) => setDraft((value) => ({ ...value, host }))} />
            <Select
              aria-label={t('localBackend.hostPresets')}
              triggerClassName={ROW_SELECT_TRIGGER}
              placeholder={t('localBackend.hostPresets')}
              isDisabled={!editable}
              selectedKey={null}
              onSelectionChange={(key) => key && setDraft((value) => ({ ...value, host: String(key) }))}
            >
              <SelectItem id="127.0.0.1" textValue="127.0.0.1">{t('localBackend.hostLoopback')}</SelectItem>
              <SelectItem id="0.0.0.0" textValue="0.0.0.0">{t('localBackend.hostAll')}</SelectItem>
              {status.connectUrls.filter((item) => item.interface).map((item) => {
                const host = new URL(item.url.replace(/^ws/, 'http')).hostname.replace(/^\[|\]$/g, '');
                return <SelectItem key={item.url} id={host} textValue={host}>{`${host} (${item.interface})`}</SelectItem>;
              })}
            </Select>
          </SettingsRow>
          <SettingsRow label={t('localBackend.port')}>
            <Input aria-label={t('localBackend.port')} size="small" className="w-28" inputMode="numeric" isDisabled={!editable} value={draft.port} onChange={(port) => setDraft((value) => ({ ...value, port }))} />
            <Button size="small" variant="secondary" disabled={!editable || !listenDirty} onClick={saveListen}>{t('common.save')}</Button>
          </SettingsRow>
          <SettingsRow label={t('localBackend.encryption')} description={t('localBackend.encryptionHint')}>
            <Select
              aria-label={t('localBackend.encryption')}
              triggerClassName={ROW_SELECT_TRIGGER}
              isDisabled={!editable}
              selectedKey={config?.pairingEncryption ?? status.pairingEncryption}
              onSelectionChange={(key) => key && void saveConfig({ pairingEncryption: String(key) as PairingEncryption })}
            >
              {ENCRYPTIONS.map((value) => <SelectItem key={value} id={value} textValue={value}>{value}</SelectItem>)}
            </Select>
          </SettingsRow>
          {config?.restartRequired ? (
            <SettingsNote tone="warning">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{canRestart ? t('localBackend.restartRequired') : t('localBackend.restartContainer')}</span>
                {canRestart && onRestart ? <Button size="small" variant="secondary" onClick={() => void onRestart().catch((cause) => setError(errorText(cause)))}>{t('localBackend.restart')}</Button> : null}
              </div>
            </SettingsNote>
          ) : null}
          {error ? <SettingsNote tone="danger" role="alert">{error}</SettingsNote> : null}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup
        label={t('localBackend.workspaceRoots')}
        description={t('localBackend.workspaceRootsHint')}
        action={editable ? <Button size="small" variant="secondary" leadingIcon={RiAddLine} onClick={() => void addRoot()}>{t('localBackend.addRoot')}</Button> : undefined}
      >
        <SettingsCard>
          {(config?.workspaceRoots ?? status.workspaceRoots).map((root, index, roots) => (
            <SettingsRow key={root} label={<span className="font-mono text-body-2-regular">{root}</span>} description={index === 0 ? t('localBackend.primaryRoot') : undefined}>
              {editable && index > 0 ? (
                <Button size="small" variant="secondary" iconOnly leadingIcon={RiStarLine} aria-label={t('localBackend.makePrimary')} onClick={() => void saveConfig({ workspaceRoots: [root, ...roots.filter((item) => item !== root)] })} />
              ) : null}
              {editable && roots.length > 1 ? (
                <Button size="small" variant="secondary" iconOnly leadingIcon={RiDeleteBinLine} aria-label={t('localBackend.removeRoot')} onClick={() => void saveConfig({ workspaceRoots: roots.filter((item) => item !== root) })} />
              ) : null}
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('localBackend.remoteAccess')} description={remote ? t('localBackend.remoteOn') : t('localBackend.remoteOff')}>
        <SettingsCard>
          {remote ? (
            <>
              {status.connectUrls.map((item) => (
                <SettingsRow key={item.url} label={<span className="font-mono text-body-2-regular">{item.url}</span>} description={item.interface ?? undefined} />
              ))}
              <SettingsNote>
                <div className="flex flex-col items-center gap-2 py-2">
                  <RecoveryQrCode payload={status.pairingLink} label={t('localBackend.pairingQr')} />
                  <span className="text-body-2-regular text-text-secondary">{t('localBackend.pairingQrHint')}</span>
                </div>
              </SettingsNote>
              <SettingsNote><CodeBlock code={status.pairingLink} language="json" /></SettingsNote>
            </>
          ) : null}
          <SettingsRow label={t('localBackend.fingerprint')} description={t('localBackend.fingerprintHint')}>
            <SettingsValueField mono wrap>{status.transportFingerprint}</SettingsValueField>
          </SettingsRow>
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('localBackend.pendingRequests')} description={t('localBackend.pendingRequestsHint')}>
        <SettingsCard>
          {requests.length ? requests.map((request) => (
            <SettingsRow
              key={request.requestId}
              label={request.deviceName}
              description={t('localBackend.requestMeta', {
                source: request.peerAddress === 'ipc' ? t('localBackend.sourceIpc') : request.peerAddress,
                time: formatTime(request.expiresAt),
              })}
            >
              <SettingsValueField mono className="w-auto">{request.verificationCode}</SettingsValueField>
              <Button size="small" onClick={() => void act(() => api.decidePairing(instance, request.requestId, true, request.verificationCode))}>{t('localBackend.approve')}</Button>
              <Button size="small" variant="secondary" onClick={() => void act(() => api.decidePairing(instance, request.requestId, false, request.verificationCode))}>{t('localBackend.reject')}</Button>
            </SettingsRow>
          )) : <SettingsNote>{t('localBackend.noRequests')}</SettingsNote>}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('localBackend.devices')}>
        <SettingsCard>
          {devices.length ? devices.map((device) => (
            <SettingsRow key={device.deviceId} label={device.name} description={t('localBackend.deviceMeta', { paired: formatTime(device.pairedAt), seen: formatTime(device.lastSeenAt) })}>
              <Button size="small" variant="secondary" onClick={() => setConfirmRevoke(device)}>{t('localBackend.revoke')}</Button>
            </SettingsRow>
          )) : <SettingsNote>{t('localBackend.noDevices')}</SettingsNote>}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('localBackend.reset')} description={t('localBackend.resetHint')}>
        <div className="flex flex-wrap gap-2 px-3">
          <Button size="small" variant="danger" onClick={() => setConfirmReset('devices')}>{t('localBackend.resetDevices')}</Button>
          <Button size="small" variant="danger" onClick={() => setConfirmReset('encryption')}>{t('localBackend.resetEncryption')}</Button>
        </div>
      </SettingsGroup>

      <ConfirmDialog
        isOpen={confirmHost}
        onOpenChange={setConfirmHost}
        title={t('localBackend.remoteConfirmTitle')}
        description={t('localBackend.remoteConfirmBody')}
        confirmLabel={t('localBackend.remoteConfirm')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          setConfirmHost(false);
          void saveConfig({ host: draft.host.trim(), port: Number(draft.port) });
        }}
      />
      <ConfirmDialog
        isOpen={confirmRevoke !== null}
        onOpenChange={(open) => !open && setConfirmRevoke(null)}
        title={t('localBackend.revokeTitle', { name: confirmRevoke?.name ?? '' })}
        description={t('localBackend.revokeBody')}
        confirmLabel={t('localBackend.revoke')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          const device = confirmRevoke;
          setConfirmRevoke(null);
          if (device) void act(() => api.revokeDevice(instance, device.deviceId));
        }}
      />
      <ConfirmDialog
        isOpen={confirmReset !== null}
        onOpenChange={(open) => !open && setConfirmReset(null)}
        title={confirmReset === 'encryption' ? t('localBackend.resetEncryption') : t('localBackend.resetDevices')}
        description={confirmReset === 'encryption' ? t('localBackend.resetEncryptionBody') : t('localBackend.resetDevicesBody')}
        confirmLabel={t('localBackend.resetConfirm')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          const target = confirmReset;
          setConfirmReset(null);
          if (!target) return;
          // The reset also drops this app's own pairing: restart, then pair again over IPC.
          void act(async () => {
            await api.reset(instance, target);
            if (canRestart && onRestart) {
              await onRestart();
              await onRepair();
            }
          });
        }}
      />
    </>
  );
}

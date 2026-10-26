import { deviceIdentityFromSecret, generateDeviceIdentity } from '@todex/protocol/deviceAuth';
import { ipcServerInstance, ipcServerUrl, isIpcServerUrl } from '@todex/protocol/ipcServerUrl';
import { isLoopbackHostname } from '@todex/protocol/loopback';
import type { BackendConnectionProfile } from '@todex/protocol/todex';
import type { LocalNativeEndpoint } from '../../preload/localBackendTypes';
import { ipcDaemonConflicts } from './backendRouting';
import { t } from '../i18n';
import {
  DevicePairingRetryableError,
  PAIRING_POLL_INTERVAL_MS,
  beginDevicePairing,
  nextPairingPollDelayMs,
  type DevicePairingRequest,
} from './devicePairing';

export type PairingCredentials = Pick<BackendConnectionProfile, 'deviceSecret' | 'encryptionProtocol' | 'encryptionPublicKey' | 'transportVerified'>;

/**
 * Device pairing whose approval this app performs itself (`approve`): the
 * request is created as usual, approved through a local channel (the IPC
 * local-admin API, or `docker exec … pair approve`), then polled until the
 * backend hands over the credential. Resolves the credentials to pin.
 */
export async function pairWithLocalApproval(options: {
  serverUrl: string;
  deviceName: string;
  /** The profile's device key, reused when re-pairing; a new one otherwise. */
  deviceSecret?: string;
  approve: (request: DevicePairingRequest) => Promise<void>;
  signal?: AbortSignal;
}): Promise<PairingCredentials> {
  const deviceSecret = options.deviceSecret && deviceIdentityFromSecret(options.deviceSecret)
    ? options.deviceSecret
    : generateDeviceIdentity().secretKey;
  const device = deviceIdentityFromSecret(deviceSecret)!;
  const request = await beginDevicePairing(options.serverUrl, options.deviceName, device, options.signal);
  try {
    await options.approve(request);
  } catch (error) {
    await request.cancel().catch(() => undefined);
    throw error;
  }
  let delay = 0;
  for (;;) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() >= request.expiresAt) throw new Error(t('localBackend.pairExpired'));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const result = await request.poll(options.signal);
      if (result.status === 'approved') {
        return {
          deviceSecret,
          encryptionProtocol: result.pin.encryptionProtocol,
          encryptionPublicKey: result.pin.encryptionPublicKey,
          transportVerified: true,
        };
      }
      if (result.status !== 'pending') throw new Error(t(result.status === 'rejected' ? 'localBackend.pairRejected' : 'localBackend.pairExpired'));
      delay = delay ? PAIRING_POLL_INTERVAL_MS : 300;
    } catch (error) {
      if (!(error instanceof DevicePairingRetryableError)) throw error;
      delay = nextPairingPollDelayMs(delay || PAIRING_POLL_INTERVAL_MS, error);
    }
  }
}

type ManagedSession = {
  backendConnections: BackendConnectionProfile[];
  addBackendConnection: (profile?: Partial<BackendConnectionProfile>) => BackendConnectionProfile;
  updateBackendConnection: (id: string, patch: Partial<BackendConnectionProfile>) => void;
  replaceBackendConnection: (loserId: string, winnerId: string) => void;
  connect: (backendId: string) => void;
  onDevicePairingApproved: (profileId: string, credentials: PairingCredentials) => void;
};

/** The IPC instance of the backend on this machine. */
export const NATIVE_INSTANCE = 'local';

/** Preferences of the 本机 Backend settings page (also read by the IPC reminder). */
export const LOCAL_BACKEND_PREFS_KEY = 'todex.desktop.localBackend.v1';
export type LocalBackendPrefs = { stopOnQuit?: boolean; suggestIpc?: boolean };

/** The connection profile of a local IPC backend instance, if one exists. */
export function managedProfile(profiles: BackendConnectionProfile[], instance: string): BackendConnectionProfile | undefined {
  const url = ipcServerUrl(instance);
  return profiles.find((profile) => profile.serverUrl === url);
}

/**
 * Makes sure this app is connected to the IPC backend `instance`: creates its
 * profile when missing, pairs it (approving the request over the socket) when
 * unpaired or when `repair` is set, then connects.
 */
export async function ensureManagedConnection(session: ManagedSession, options: {
  instance: string;
  name: string;
  deviceName: string;
  repair?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const localBackend = window.todexDesktop.localBackend;
  const serverUrl = ipcServerUrl(options.instance);
  const profile = managedProfile(session.backendConnections, options.instance)
    ?? session.addBackendConnection({ name: options.name, serverUrl });
  const paired = profile.transportVerified && Boolean(deviceIdentityFromSecret(profile.deviceSecret));
  // A disabled IPC profile takes its daemon back from the profile serving it.
  const peer = profile.disabled ? daemonPeer(session.backendConnections, profile) : undefined;
  if (peer && paired && !options.repair) {
    session.replaceBackendConnection(peer.id, profile.id);
    return profile.id;
  }
  if (paired && !options.repair) {
    session.connect(profile.id);
    return profile.id;
  }
  const credentials = await pairWithLocalApproval({
    serverUrl,
    deviceName: options.deviceName,
    deviceSecret: profile.deviceSecret,
    approve: (request) => localBackend.approveOwnPairing(options.instance, request.requestId, request.verificationCode),
    signal: options.signal,
  });
  session.onDevicePairingApproved(profile.id, credentials);
  if (peer) session.replaceBackendConnection(peer.id, profile.id);
  return profile.id;
}

/** Whether `serverUrl` reaches this machine's daemon over TCP: a loopback
 * host on the daemon's port (`0.0.0.0` listeners answer on loopback too). */
function reachesNativePort(serverUrl: string, port: number): boolean {
  let url: URL;
  try {
    url = new URL(serverUrl.trim());
  } catch {
    return false;
  }
  const defaultPort = url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : url.protocol === 'http:' || url.protocol === 'ws:' ? 80 : null;
  if (defaultPort === null || !isLoopbackHostname(url.hostname)) return false;
  return (url.port ? Number(url.port) : defaultPort) === port;
}

/**
 * The enabled profiles that reach a daemon an enabled IPC profile serves,
 * each with the IPC profile that takes over (see `ipcDaemonConflicts`). With
 * the native daemon's endpoint known, a loopback profile on its port counts
 * even before the IPC profile pinned a key.
 */
export function daemonConflicts(profiles: BackendConnectionProfile[], endpoint: LocalNativeEndpoint | null) {
  const port = endpoint?.running ? endpoint.port : null;
  return ipcDaemonConflicts(profiles, isIpcServerUrl, (ipcUrl, serverUrl) => (
    port !== null && ipcServerInstance(ipcUrl) === NATIVE_INSTANCE && reachesNativePort(serverUrl, port)
  ));
}

/** The enabled profile serving the daemon of disabled `profile`: the one
 * pinning the same transport key, else (for a TCP profile) the enabled
 * native IPC profile. */
export function daemonPeer(profiles: BackendConnectionProfile[], profile: BackendConnectionProfile): BackendConnectionProfile | undefined {
  const enabled = profiles.filter((item) => item.id !== profile.id && !item.disabled);
  const sameKey = profile.transportVerified && profile.encryptionPublicKey
    ? enabled.find((item) => item.transportVerified && item.encryptionPublicKey === profile.encryptionPublicKey)
    : undefined;
  if (sameKey || isIpcServerUrl(profile.serverUrl)) return sameKey;
  return enabled.find((item) => item.serverUrl === ipcServerUrl(NATIVE_INSTANCE));
}

/**
 * The connected profile that reaches the native daemon over TCP although the
 * daemon also serves IPC, i.e. the one worth switching to `todex-ipc://local`.
 * None when an IPC profile for the daemon already exists.
 */
export function nativeIpcCandidate(
  profiles: BackendConnectionProfile[],
  endpoint: LocalNativeEndpoint,
  isConnected: (profileId: string) => boolean,
): BackendConnectionProfile | undefined {
  const { port } = endpoint;
  if (!endpoint.running || !endpoint.ipcPath || port === null) return undefined;
  if (managedProfile(profiles, NATIVE_INSTANCE)) return undefined;
  return profiles.find((profile) => isConnected(profile.id) && reachesNativePort(profile.serverUrl, port));
}

/**
 * Re-points a loopback profile of the native daemon at its IPC socket, keeping
 * the profile (and the conversations and workspaces filed under it). The
 * daemon is the same, so are its device registry and transport key: the
 * pinned credentials stay valid. An unpaired profile pairs over IPC instead.
 */
export async function switchToNativeIpc(session: ManagedSession, profileId: string, deviceName: string): Promise<void> {
  const profile = session.backendConnections.find((item) => item.id === profileId);
  if (!profile) throw new Error(t('localBackend.profileMissing'));
  const serverUrl = ipcServerUrl(NATIVE_INSTANCE);
  if (profile.transportVerified && deviceIdentityFromSecret(profile.deviceSecret)) {
    const credentials: PairingCredentials = {
      deviceSecret: profile.deviceSecret,
      encryptionProtocol: profile.encryptionProtocol,
      encryptionPublicKey: profile.encryptionPublicKey,
      transportVerified: profile.transportVerified,
    };
    session.updateBackendConnection(profile.id, { serverUrl, ...credentials });
    // Connects once the re-pointed profile is committed.
    session.onDevicePairingApproved(profile.id, credentials);
    return;
  }
  const credentials = await pairWithLocalApproval({
    serverUrl,
    deviceName,
    deviceSecret: profile.deviceSecret,
    approve: (request) => window.todexDesktop.localBackend.approveOwnPairing(NATIVE_INSTANCE, request.requestId, request.verificationCode),
  });
  session.updateBackendConnection(profile.id, { serverUrl, ...credentials });
  session.onDevicePairingApproved(profile.id, credentials);
}

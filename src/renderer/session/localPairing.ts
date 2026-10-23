import { deviceIdentityFromSecret, generateDeviceIdentity } from '@todex/protocol/deviceAuth';
import { ipcServerUrl } from '@todex/protocol/ipcServerUrl';
import type { BackendConnectionProfile } from '@todex/protocol/todex';
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
  connect: (backendId: string) => void;
  onDevicePairingApproved: (profileId: string, credentials: PairingCredentials) => void;
};

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
  return profile.id;
}

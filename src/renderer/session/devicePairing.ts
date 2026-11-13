import {
  beginDevicePairing as beginSharedDevicePairing,
  type DevicePairingErrorCode,
  type DevicePairingMesh,
  type DevicePairingRequest,
} from '@todex/protocol/devicePairing';
import type { DeviceIdentity } from '@todex/protocol/deviceAuth';
import { t, type MessageKey } from '../i18n';

export {
  DevicePairingError,
  DevicePairingRetryableError,
  PAIRING_POLL_INTERVAL_MS,
  PAIRING_POLL_MAX_BACKOFF_MS,
  fetchBackendDeployment,
  nextPairingPollDelayMs,
  type DevicePairingRequest,
  type DevicePairingResult,
} from '@todex/protocol/devicePairing';

const PAIRING_MESSAGES: Record<DevicePairingErrorCode, MessageKey> = {
  checksum: 'pair.errChecksum',
  conflict: 'pair.errConflict',
  encryptionRequired: 'pair.errEncryptionRequired',
  http: 'pair.errHttp',
  invalidRequest: 'pair.errInvalidRequest',
  invalidResponse: 'pair.errInvalidResponse',
  invalidStatus: 'pair.errInvalidStatus',
  invalidTransport: 'pair.errInvalidTransport',
  invalidUrl: 'pair.errInvalidUrl',
  network: 'pair.errNetwork',
  noResult: 'pair.errNoResult',
  polling: 'pair.errPolling',
  rejectedRequest: 'pair.errRejectedRequest',
  timeout: 'pair.errTimeout',
  tooLarge: 'pair.errTooLarge',
  tooMany: 'pair.errTooMany',
  transportMismatch: 'pair.errTransportMismatch',
  unsupported: 'pair.errUnsupported',
};

/** The shared pairing v3 flow (`@todex/protocol/devicePairing`) with this
 * client's error wording; `mesh` joins a device group instead. */
export function beginDevicePairing(serverUrl: string, deviceName: string, device: DeviceIdentity, signal?: AbortSignal, mesh?: DevicePairingMesh): Promise<DevicePairingRequest> {
  return beginSharedDevicePairing(serverUrl, deviceName, device, signal, {
    message: (code, params) => t(PAIRING_MESSAGES[code], params.status === undefined ? undefined : { status: params.status }),
    ...(mesh ? { mesh } : {}),
  });
}

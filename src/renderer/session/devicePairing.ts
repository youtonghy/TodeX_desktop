import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { buildHttpUrl } from '@todex/protocol/todex';
import { decodeBase64Url, type DeviceIdentity } from '@todex/protocol/deviceAuth';
import {
  DEVICE_PAIRING_V3_NONCE_LENGTH,
  DevicePairingTransportError,
  deriveDevicePairingV3Material,
  devicePairingV3Commitment,
  normalizeDevicePairingName,
  parseDevicePairingTransport,
  transportFingerprint,
  verifyDevicePairingCredential,
  type DevicePairingPin,
  type DevicePairingTransport,
  type DevicePairingV3Material,
} from '@todex/protocol/secureChannel';
import { t } from '../i18n';

export type DevicePairingResult =
  | { status: 'pending' | 'rejected' | 'expired' }
  | { status: 'approved'; deviceId: string; pin: DevicePairingPin };

export type DevicePairingRequest = {
  verificationCode: string;
  /** Fingerprint of the transport key the code authenticates (`'none'` for loopback plaintext). */
  transportFingerprint: string;
  expiresAt: number;
  poll: (signal?: AbortSignal) => Promise<DevicePairingResult>;
  cancel: (signal?: AbortSignal) => Promise<void>;
};

const MAX_RESPONSE_BYTES = 16_384;
const REQUEST_TIMEOUT_MS = 10_000;
/** Normal poll interval while a request waits for approval. */
export const PAIRING_POLL_INTERVAL_MS = 2000;
/** Longest wait between polls after transient failures. */
export const PAIRING_POLL_MAX_BACKOFF_MS = 5000;

/**
 * A pairing call that failed transiently (`429`, `5xx`, network error or
 * timeout). Polling backs off and continues until the request expires; it
 * ends only on `404`, `401`/`403`, a rejected or expired request, or when the
 * user cancels.
 */
export class DevicePairingRetryableError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'DevicePairingRetryableError';
  }
}

/** Next poll delay after a transient failure: doubled, at least `Retry-After`, at most 5 s. */
export function nextPairingPollDelayMs(previousMs: number, error: DevicePairingRetryableError): number {
  return Math.min(Math.max(previousMs * 2, error.retryAfterMs ?? 0), PAIRING_POLL_MAX_BACKOFF_MS);
}

function retryAfterMs(value: string | null): number | undefined {
  const trimmed = (value ?? '').trim();
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) * 1000 : undefined;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16}$/;

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: unknown, length?: number): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_RESPONSE_BYTES) {
    throw new Error(t('pair.errInvalidResponse'));
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
  } catch {
    throw new Error(t('pair.errInvalidResponse'));
  }
  if ((length !== undefined && bytes.length !== length) || encode(bytes) !== value) {
    throw new Error(t('pair.errInvalidResponse'));
  }
  return bytes;
}

/** The create response's transport key, validated before anything is derived from it. */
function pairingTransport(response: Record<string, unknown>, serverUrl: string): DevicePairingTransport {
  try {
    return parseDevicePairingTransport(response, serverUrl);
  } catch (error) {
    if (error instanceof DevicePairingTransportError && error.reason === 'encryption_required') {
      throw new Error(t('pair.errEncryptionRequired'));
    }
    throw new Error(t('pair.errInvalidTransport'));
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('pair.errInvalidResponse'));
  return value as Record<string, unknown>;
}

// Pairing runs before a transport key is pinned, so its routes are called
// directly (they are on the backend's plaintext allow-list), never through
// the `/v2/sealed` tunnel.
async function post(serverUrl: string, action: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const url = new URL(buildHttpUrl(serverUrl, `/v2/device-pairing/${action}`));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(t('pair.errInvalidUrl'));
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  // A failed connection or body read is transient; the caller's abort is not.
  const networkFailure = (error: unknown): unknown => (signal?.aborted || controller.signal.aborted
    ? error
    : new DevicePairingRetryableError(t('pair.errNetwork')));
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch (error) {
      throw networkFailure(error);
    }
    if (!response.ok) {
      if (response.status === 404) throw new Error(t('pair.errUnsupported'));
      if (response.status === 429) {
        throw new DevicePairingRetryableError(t('pair.errTooMany'), retryAfterMs(response.headers.get('Retry-After')));
      }
      if (response.status === 401 || response.status === 403) throw new Error(t('pair.errRejectedRequest'));
      if (response.status >= 500) throw new DevicePairingRetryableError(t('pair.errHttp', { status: response.status }));
      throw new Error(t('pair.errHttp', { status: response.status }));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error(t('pair.errNoResult'));
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await reader.read();
        } catch (error) {
          throw networkFailure(error);
        }
        const { done, value } = next;
        if (done) break;
        size += value.length;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error(t('pair.errTooLarge'));
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } catch {
      throw new Error(t('pair.errInvalidResponse'));
    }
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new DevicePairingRetryableError(t('pair.errTimeout'));
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** Device pairing v3 (commit, then reveal): `create` sends only a commitment
 * to the ephemeral key and nonce, the server answers with its per-request
 * key and its transport key, and only then `reveal` discloses them, so a man
 * in the middle cannot grind its own key against the short code. The
 * transcript binds the transport protocol and key and the device name, so the
 * code the user compares also authenticates the key that gets pinned and the
 * name the backend shows. `deviceName` is normalized first
 * (`normalizeDevicePairingName`, `'TodeX'` when nothing is left) and sent
 * exactly as bound. The device key is
 * enrolled on approval; approval returns the matching `deviceId` and the
 * verified pin (`verifyDevicePairingCredential`), which the caller writes in
 * one profile update with `transportVerified = true`. */
export async function beginDevicePairing(serverUrl: string, deviceName: string, device: DeviceIdentity, signal?: AbortSignal): Promise<DevicePairingRequest> {
  const keys = x25519.keygen();
  const clientNonce = globalThis.crypto.getRandomValues(new Uint8Array(DEVICE_PAIRING_V3_NONCE_LENGTH));
  let material: DevicePairingV3Material | undefined;
  const wipe = () => {
    material?.wrapKey.fill(0);
    material?.pollProof.fill(0);
    material?.cancelProof.fill(0);
  };
  const devicePublicKey = decodeBase64Url(device.publicKey);
  const boundName = normalizeDevicePairingName(deviceName, 'TodeX');
  try {
    const response = await post(serverUrl, 'create', {
      transportBinding: 1,
      deviceNameBinding: 1,
      clientCommitment: encode(devicePairingV3Commitment(keys.publicKey, clientNonce)),
      devicePublicKey: device.publicKey,
      deviceName: boundName,
    }, signal);
    const { requestId, expiresAt } = response;
    if (typeof requestId !== 'string' || !uuidPattern.test(requestId)
      || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
      throw new Error(t('pair.errInvalidRequest'));
    }
    const serverKey = decode(response.serverPublicKey, 32);
    const transport = pairingTransport(response, serverUrl);
    try {
      material = deriveDevicePairingV3Material({
        requestId,
        clientSecretKey: keys.secretKey,
        serverPublic: serverKey,
        devicePublic: devicePublicKey,
        clientNonce,
        transportProtocol: transport.protocol,
        transportPublicKey: transport.publicKeyRaw,
        deviceName: boundName,
      });
    } catch {
      throw new Error(t('pair.errInvalidResponse'));
    }
    // The server shows the verification code only after the reveal opened
    // the commitment.
    const revealed = await post(serverUrl, 'reveal', {
      requestId,
      clientPublicKey: encode(keys.publicKey),
      clientNonce: encode(clientNonce),
    }, signal);
    if (revealed.status !== 'pending') throw new Error(t('pair.errInvalidStatus'));
    const { transcript, wrapKey, pollProof, cancelProof } = material;
    let finished = false;
    let polling = false;
    const dispose = () => {
      finished = true;
      wipe();
    };
    return {
      verificationCode: material.verificationCode,
      transportFingerprint: transportFingerprint(transport.protocol, transport.publicKeyRaw),
      expiresAt,
      async poll(pollSignal) {
        if (finished || Date.now() >= expiresAt) { dispose(); return { status: 'expired' }; }
        if (polling) throw new Error(t('pair.errPolling'));
        polling = true;
        try {
          const result = await post(serverUrl, 'poll', { requestId, proof: encode(pollProof) }, pollSignal);
          if (finished || Date.now() >= expiresAt) { dispose(); return { status: 'expired' }; }
          if (result.status === 'pending') return { status: 'pending' };
          if (result.status === 'rejected' || result.status === 'expired') {
            dispose();
            return { status: result.status };
          }
          if (result.status !== 'approved') throw new Error(t('pair.errInvalidStatus'));
          try {
            const nonce = decode(result.nonce, 24);
            const ciphertext = decode(result.ciphertext);
            const plaintext = xchacha20poly1305(wrapKey, nonce, transcript).decrypt(ciphertext);
            try {
              const payload = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
              if (typeof payload.deviceId !== 'string' || !DEVICE_ID_PATTERN.test(payload.deviceId)) {
                throw new Error('Invalid device id');
              }
              // The device id and the transport key must equal this device
              // and the create response byte for byte; otherwise pin nothing.
              const pin = verifyDevicePairingCredential(payload, { deviceId: device.deviceId, transport });
              return { status: 'approved', deviceId: payload.deviceId, pin };
            } finally {
              plaintext.fill(0);
            }
          } catch (error) {
            if (error instanceof DevicePairingTransportError) throw new Error(t('pair.errTransportMismatch'));
            throw new Error(t('pair.errChecksum'));
          } finally {
            dispose();
          }
        } finally {
          polling = false;
        }
      },
      async cancel(cancelSignal) {
        if (finished) return;
        const proof = encode(cancelProof);
        dispose();
        await post(serverUrl, 'cancel', { requestId, proof }, cancelSignal);
      },
    };
  } catch (error) {
    wipe();
    throw error;
  } finally {
    keys.secretKey.fill(0);
    clientNonce.fill(0);
  }
}

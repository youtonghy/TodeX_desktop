import { buildHttpUrl, type ConnectionSettings } from '@todex/protocol/todex';
import { t, subscribeLocale } from '../i18n';
import type { TransportCryptoSession } from '@todex/protocol/transportCrypto';
import { SocketVerificationError, verifyEncryptedSocket as verifySocket } from '@todex/protocol/socketVerification';

export let ENCRYPTION_VERIFICATION_ERROR = t('transport.notVerified');
subscribeLocale(() => { ENCRYPTION_VERIFICATION_ERROR = t('transport.notVerified'); });
const TIMEOUT_MS = 10_000;

/** Verification failures split into transport problems worth retrying (network
 * blips, timeouts, sockets dropped mid-handshake) and configuration problems
 * that need user action (missing key, protocol mismatch). Only the latter
 * should disable automatic reconnect. */
export class TransportVerificationError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'TransportVerificationError';
    this.retryable = retryable;
  }
}

/** Policy discovery contains no keys and never changes the user's encryption
 * selection. The backend independently enforces the policy at the handshake. */
export async function validateTransportEncryption(settings: ConnectionSettings, signal?: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, TIMEOUT_MS);
  try {
    const response = await fetch(buildHttpUrl(settings.serverUrl, '/v2/transport-policy'), {
      signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    // Older backends do not advertise a policy. Their existing handshake still
    // applies, and an explicitly encrypted client must still have a local key.
    if (response.status !== 404) {
      if (!response.ok) throw new TransportVerificationError(t('transport.cannotConfirmPolicy'), response.status >= 500);
      const text = await response.text();
      if (text.length > 2048) throw new TransportVerificationError(t('transport.invalidPolicy'));
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new TransportVerificationError(t('transport.invalidPolicy')); }
      const protocol = value && typeof value === 'object' ? (value as Record<string, unknown>).requiredProtocol : undefined;
      if (protocol !== 'none' && protocol !== 'x25519' && protocol !== 'ml-kem-768') throw new TransportVerificationError(t('transport.invalidPolicyUpdate'));
      if (protocol !== 'none' && settings.encryptionProtocol !== protocol) {
        throw new TransportVerificationError(t('transport.protocolRequired', { protocol }));
      }
    }
    if (settings.encryptionProtocol !== 'none' && !settings.encryptionPublicKey.trim()) {
      throw new TransportVerificationError(ENCRYPTION_VERIFICATION_ERROR);
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  } catch (error) {
    if (error instanceof TransportVerificationError) throw error;
    if (controller.signal.aborted && !signal?.aborted) throw new TransportVerificationError(t('transport.policyTimeout'), true);
    if (signal?.aborted) throw error;
    throw new TransportVerificationError(t('transport.policyUnreachable'), true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Consume the encrypted ping response before the normal message dispatcher
 * starts; see the shared `verifyEncryptedSocket`. Failures carry the
 * localized verification message. */
export async function verifyEncryptedSocket(socket: WebSocket, session: TransportCryptoSession, signal?: AbortSignal): Promise<void> {
  try {
    await verifySocket(socket, session, { signal, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    if (error instanceof SocketVerificationError) throw new TransportVerificationError(ENCRYPTION_VERIFICATION_ERROR, error.retryable);
    throw error;
  }
}

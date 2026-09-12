import { buildHttpUrl, type ConnectionSettings } from '@todex/protocol/todex';
import type { TransportCryptoSession } from '@todex/protocol/transportCrypto';

export const ENCRYPTION_VERIFICATION_ERROR = '尚未通过加密密钥传输验证。请通过后端二维码或复制粘贴导入正确的加密公钥后重新连接。';
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
      if (!response.ok) throw new TransportVerificationError('无法确认后端加密要求，请检查后端状态后重试。', response.status >= 500);
      const text = await response.text();
      if (text.length > 2048) throw new TransportVerificationError('后端加密要求响应无效。');
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new TransportVerificationError('后端加密要求响应无效。'); }
      const protocol = value && typeof value === 'object' ? (value as Record<string, unknown>).requiredProtocol : undefined;
      if (protocol !== 'none' && protocol !== 'x25519' && protocol !== 'ml-kem-768') throw new TransportVerificationError('后端加密要求响应无效，请更新客户端或后端。');
      if (protocol !== 'none' && settings.encryptionProtocol !== protocol) {
        throw new TransportVerificationError(`后端要求 ${protocol} 加密，当前连接尚未完成加密密钥传输验证。请通过二维码或复制粘贴导入对应公钥，并选择 ${protocol} 后重新连接。`);
      }
    }
    if (settings.encryptionProtocol !== 'none' && !settings.encryptionPublicKey.trim()) {
      throw new TransportVerificationError(ENCRYPTION_VERIFICATION_ERROR);
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  } catch (error) {
    if (error instanceof TransportVerificationError) throw error;
    if (controller.signal.aborted && !signal?.aborted) throw new TransportVerificationError('确认后端加密要求超时，请检查连接后重试。', true);
    if (signal?.aborted) throw error;
    throw new TransportVerificationError('无法连接后端以确认加密要求，将自动重试。', true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Consume the encrypted ping response before the normal message dispatcher
 * starts. This verifies actual possession of the imported server key, rather
 * than treating the HTTP WebSocket upgrade as a successful encrypted session. */
export function verifyEncryptedSocket(socket: WebSocket, session: TransportCryptoSession, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = `transport-verification-${globalThis.crypto.randomUUID()}`;
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onTransportFailure);
      socket.removeEventListener('error', onTransportFailure);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    // A dropped socket during the handshake is transient; an undecryptable or
    // wrong reply means the imported key does not match the server.
    const onTransportFailure = () => finish(new TransportVerificationError(ENCRYPTION_VERIFICATION_ERROR, true));
    const onProtocolFailure = () => finish(new TransportVerificationError(ENCRYPTION_VERIFICATION_ERROR));
    const onAbort = () => finish(new DOMException('Aborted', 'AbortError'));
    const onMessage = (event: MessageEvent) => {
      try {
        const value = JSON.parse(session.decryptServerText(String(event.data))) as Record<string, unknown>;
        if (value.id !== id) return;
        const payload = value.payload as { pong?: unknown } | undefined;
        if (value.type !== 'server.result' || payload?.pong !== true) { onProtocolFailure(); return; }
        finish();
      } catch { onProtocolFailure(); }
    };
    const timer = setTimeout(onTransportFailure, TIMEOUT_MS);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onTransportFailure);
    socket.addEventListener('error', onTransportFailure);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try {
      socket.send(session.encryptClientText(JSON.stringify({ id, type: 'server.ping', payload: {} })));
    } catch { onTransportFailure(); }
  });
}

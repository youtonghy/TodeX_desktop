import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildHttpUrl } from '@todex/protocol/todex';

export type DevicePairingResult =
  | { status: 'pending' | 'rejected' | 'expired' }
  | { status: 'approved'; authToken: string };

export type DevicePairingRequest = {
  verificationCode: string;
  expiresAt: number;
  poll: (signal?: AbortSignal) => Promise<DevicePairingResult>;
  cancel: (signal?: AbortSignal) => Promise<void>;
};

const encoder = new TextEncoder();
const DOMAIN = 'todex.device-pairing.v1/';
const MAX_RESPONSE_BYTES = 16_384;
const REQUEST_TIMEOUT_MS = 10_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: unknown, length?: number): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_RESPONSE_BYTES) {
    throw new Error('设备验证响应格式无效');
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
  } catch {
    throw new Error('设备验证响应格式无效');
  }
  if ((length !== undefined && bytes.length !== length) || encode(bytes) !== value) {
    throw new Error('设备验证响应格式无效');
  }
  return bytes;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设备验证响应格式无效');
  return value as Record<string, unknown>;
}

async function post(serverUrl: string, action: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const url = new URL(buildHttpUrl(serverUrl, `/v2/device-pairing/${action}`));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('请输入有效的后端 HTTP 或 HTTPS 地址');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error('当前后端不支持设备验证，请更新后端或手动填写令牌');
      if (response.status === 429) throw new Error('设备申请过于频繁或队列已满，请稍后重试');
      if (response.status === 401 || response.status === 403) throw new Error('设备验证请求未被接受，请重新申请');
      throw new Error(`设备验证失败（HTTP ${response.status}），请检查后端状态`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('后端未返回设备验证结果');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error('设备验证响应过大');
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
      throw new Error('设备验证响应格式无效');
    }
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('设备验证请求超时，请检查后端连接');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** The short code authenticates only this enrollment. It never replaces the
 * separately imported, long-lived transport encryption public key. */
export async function beginDevicePairing(serverUrl: string, deviceName: string, signal?: AbortSignal): Promise<DevicePairingRequest> {
  const keys = x25519.keygen();
  let wrapKey: Uint8Array | undefined;
  let pollProof: Uint8Array | undefined;
  let cancelProof: Uint8Array | undefined;
  try {
    const response = await post(serverUrl, 'create', {
      clientPublicKey: encode(keys.publicKey),
      deviceName: Array.from(deviceName.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, 80).join('') || 'TodeX',
    }, signal);
    const { requestId, expiresAt } = response;
    if (typeof requestId !== 'string' || !uuidPattern.test(requestId)
      || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('设备验证申请无效或已过期，请重新申请');
    }
    const serverKey = decode(response.serverPublicKey, 32);
    const prefix = encoder.encode(`${DOMAIN}transcript\0${requestId}\0`);
    const transcript = new Uint8Array(prefix.length + 64);
    transcript.set(prefix);
    transcript.set(keys.publicKey, prefix.length);
    transcript.set(serverKey, prefix.length + 32);
    const salt = sha256(transcript);
    const shared = x25519.getSharedSecret(keys.secretKey, serverKey);
    try {
      wrapKey = hkdf(sha256, shared, salt, encoder.encode(`${DOMAIN}wrap-key`), 32);
      pollProof = hkdf(sha256, shared, salt, encoder.encode(`${DOMAIN}poll-proof`), 32);
      cancelProof = hkdf(sha256, shared, salt, encoder.encode(`${DOMAIN}cancel-proof`), 32);
    } finally {
      shared.fill(0);
    }
    const code = Array.from(salt.slice(0, 5), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
    let finished = false;
    let polling = false;
    const dispose = () => {
      finished = true;
      wrapKey?.fill(0);
      pollProof?.fill(0);
      cancelProof?.fill(0);
    };
    return {
      verificationCode: `${code.slice(0, 5)}-${code.slice(5)}`,
      expiresAt,
      async poll(pollSignal) {
        if (finished || Date.now() >= expiresAt) { dispose(); return { status: 'expired' }; }
        if (polling) throw new Error('设备验证正在查询，请稍候');
        polling = true;
        try {
          const result = await post(serverUrl, 'poll', { requestId, proof: encode(pollProof!) }, pollSignal);
          if (finished || Date.now() >= expiresAt) { dispose(); return { status: 'expired' }; }
          if (result.status === 'pending') return { status: 'pending' };
          if (result.status === 'rejected' || result.status === 'expired') {
            dispose();
            return { status: result.status };
          }
          if (result.status !== 'approved') throw new Error('设备验证响应状态无效');
          try {
            const nonce = decode(result.nonce, 24);
            const ciphertext = decode(result.ciphertext);
            const plaintext = xchacha20poly1305(wrapKey!, nonce, transcript).decrypt(ciphertext);
            try {
              const payload = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
              if (typeof payload.authToken !== 'string' || !payload.authToken || payload.authToken.length > 4096 || /[\r\n]/.test(payload.authToken)) {
                throw new Error('Invalid token');
              }
              return { status: 'approved', authToken: payload.authToken };
            } finally {
              plaintext.fill(0);
            }
          } catch {
            throw new Error('设备验证结果校验失败，请重新核对验证码并申请');
          } finally {
            dispose();
          }
        } finally {
          polling = false;
        }
      },
      async cancel(cancelSignal) {
        if (finished) return;
        const proof = encode(cancelProof!);
        dispose();
        await post(serverUrl, 'cancel', { requestId, proof }, cancelSignal);
      },
    };
  } catch (error) {
    wrapKey?.fill(0);
    pollProof?.fill(0);
    cancelProof?.fill(0);
    throw error;
  } finally {
    keys.secretKey.fill(0);
  }
}

import { net, type Session } from 'electron';
import { isLoopbackUrl } from '@todex/protocol/mobileParity';
import { decodeBase64Url, deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { cachedSecureTransport, type SecureTransportProfile } from '@todex/protocol/secureTransport';
import { mainT } from './i18n';

/** The renderer's active backend: where the preview's loopback requests go. */
export type PreviewBackend = SecureTransportProfile & { deviceSecret: string };

type SetCookieDetails = Parameters<Session['cookies']['set']>[0];

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
/** Request headers that describe this hop, or that the backend sets itself. */
const DROPPED_REQUEST_HEADERS = new Set(['host', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'cookie']);
/** Forwarded requests waiting for their response head at once. The backend
 * lets one device hold 8 sealed requests until then and refuses the rest as
 * busy; a dev server's page load fires dozens of module requests, and the
 * app's own calls share the same budget. */
const MAX_IN_FLIGHT = 6;

/**
 * Sends the preview session's loopback requests to the backend's
 * `/v2/browser/proxy`, so a page served on the backend host loads under its
 * own `127.0.0.1` origin wherever the backend runs. Other requests (CDNs,
 * fonts) go out directly. Intercepted requests skip Chromium's cookie
 * handling, so the forwarder reads and fills the session's jar itself.
 */
export class PreviewProxy {
  private backend: PreviewBackend | null = null;
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly session: Session) {
    for (const scheme of ['http', 'https']) {
      session.protocol.handle(scheme, request => this.handle(request));
    }
  }

  setBackend(backend: PreviewBackend | null): void {
    this.backend = backend;
  }

  private async handle(request: Request): Promise<Response> {
    const backend = this.backend;
    if (!backend || !isLoopbackUrl(request.url)) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    const target = new URL(request.url).host;
    try {
      const headers: [string, string][] = [];
      request.headers.forEach((value, name) => {
        if (!DROPPED_REQUEST_HEADERS.has(name) && !name.startsWith('x-todex-')) headers.push([name, value]);
      });
      const cookies = await this.session.cookies.get({ url: request.url });
      if (cookies.length) headers.push(['cookie', cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')]);
      const body = request.method === 'GET' || request.method === 'HEAD' ? null : Buffer.from(await request.arrayBuffer());
      const transport = cachedSecureTransport(backend, deviceIdentityFromSecret(backend.deviceSecret));
      // The backend frees its slot once the head is out, so the body may
      // keep streaming (event streams too) without holding one here.
      await this.acquire(request.signal);
      let response: Awaited<ReturnType<typeof transport.fetchStream>>;
      try {
        response = await transport.fetchStream({
          method: 'POST',
          path: '/v2/browser/proxy',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: request.method, url: request.url, headers, ...(body?.length ? { body: body.toString('base64') } : {}) }),
          signal: request.signal,
        });
      } finally {
        this.release();
      }
      if (response.status !== 200) {
        const text = await collect(response.body);
        return errorPage(response.status === 404 ? mainT('preview.backendOutdated') : backendError(text, target));
      }
      const status = Number(response.headers['x-todex-proxy-status']);
      const pairs = JSON.parse(new TextDecoder().decode(decodeBase64Url(response.headers['x-todex-proxy-headers'] ?? ''))) as [string, string][];
      const responseHeaders = new Headers();
      for (const [name, value] of pairs) {
        if (name.toLowerCase() === 'set-cookie') await this.storeCookie(request.url, value);
        else responseHeaders.append(name, value);
      }
      const stream = NULL_BODY_STATUSES.has(status) || request.method === 'HEAD' ? null : readable(response.body);
      if (!stream) void collect(response.body);
      return new Response(stream, { status, headers: responseHeaders });
    } catch (error) {
      if (request.signal.aborted) throw error;
      return errorPage(mainT('preview.forwardFailed', { target, reason: error instanceof Error ? error.message : String(error) }));
    }
  }

  /** Waits for one of the MAX_IN_FLIGHT slots; rejects if the page drops the request first. */
  private async acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.inFlight < MAX_IN_FLIGHT) {
      this.inFlight += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        this.waiting.splice(this.waiting.indexOf(grant), 1);
        reject(signal.reason);
      };
      this.waiting.push(grant);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  /** Hands the slot to the next waiting request, or frees it. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.inFlight -= 1;
  }

  private async storeCookie(url: string, header: string): Promise<void> {
    const details = parseSetCookie(url, header);
    if (!details) return;
    await this.session.cookies.set(details).catch(() => undefined);
  }
}

/** A `Set-Cookie` header as `cookies.set` details; null when malformed. */
export function parseSetCookie(url: string, header: string, nowMs = Date.now()): SetCookieDetails | null {
  const [pair, ...attributes] = header.split(';');
  const separator = pair.indexOf('=');
  if (separator <= 0) return null;
  const details: SetCookieDetails = { url, name: pair.slice(0, separator).trim(), value: pair.slice(separator + 1).trim() };
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (key === 'path' && value.startsWith('/')) details.path = value;
    else if (key === 'domain' && value) details.domain = value;
    else if (key === 'secure') details.secure = true;
    else if (key === 'httponly') details.httpOnly = true;
    else if (key === 'samesite') {
      const sameSite = value.toLowerCase();
      details.sameSite = sameSite === 'strict' ? 'strict' : sameSite === 'none' ? 'no_restriction' : 'lax';
    } else if (key === 'max-age' && /^-?\d+$/.test(value)) {
      details.expirationDate = nowMs / 1000 + Number(value);
    } else if (key === 'expires' && details.expirationDate === undefined) {
      const expires = Date.parse(value);
      if (Number.isFinite(expires)) details.expirationDate = expires / 1000;
    }
  }
  return details;
}

function backendError(text: string, target: string): string {
  try {
    const { code, message } = JSON.parse(text) as { code?: unknown; message?: unknown };
    if (code === 'BROWSER_TARGET_UNREACHABLE') return mainT('preview.targetUnreachable', { target });
    if (typeof message === 'string' && message) return mainT('preview.forwardFailed', { target, reason: message });
  } catch {
    // Not a backend error body.
  }
  return mainT('preview.forwardFailed', { target, reason: text.slice(0, 200) || 'HTTP error' });
}

function errorPage(message: string): Response {
  return new Response(message, { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

function readable(body: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of body) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

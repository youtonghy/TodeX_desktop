import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { Readable } from 'node:stream';
import WebSocket from 'ws';

/** Host header sent over the local channel; backends check it is loopback. */
const IPC_HOST = 'localhost';

export type SocketRequest = {
  method: string;
  /** Path and query, e.g. `/v2/version?x=1`. */
  path: string;
  headers?: Record<string, string>;
  body?: ReadableStream<Uint8Array> | Uint8Array | string | null;
  signal?: AbortSignal;
};

function responseHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** One HTTP request to the backend listening on `socketPath` (a Unix socket
 * or a Windows named pipe), answered as a streaming `Response`. */
export function socketFetch(socketPath: string, init: SocketRequest): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      socketPath,
      method: init.method,
      path: init.path,
      headers: { ...init.headers, host: IPC_HOST },
      signal: init.signal,
    }, (res) => {
      const status = res.statusCode ?? 502;
      const body = NULL_BODY_STATUSES.has(status) || init.method === 'HEAD'
        ? null
        : Readable.toWeb(res) as ReadableStream<Uint8Array>;
      if (!body) res.resume();
      resolve(new Response(body, { status, statusText: res.statusMessage, headers: responseHeaders(res.headers) }));
    });
    req.on('error', reject);
    const { body } = init;
    if (body == null) {
      req.end();
    } else if (typeof body === 'string' || body instanceof Uint8Array) {
      req.end(body);
    } else {
      Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>).on('error', (error) => req.destroy(error)).pipe(req);
    }
  });
}

/** `socketFetch` returning parsed JSON, throwing the backend's error message on failure. */
export async function socketJson<T>(socketPath: string, method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
  const response = await socketFetch(socketPath, {
    method,
    path,
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; reported below when the status is an error.
  }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const message = typeof error?.message === 'string' ? error.message : text.trim() || `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, code: typeof error?.code === 'string' ? error.code : undefined });
  }
  return parsed as T;
}

/** A WebSocket to `path` on the backend listening on `socketPath`. */
export function socketWebSocket(socketPath: string, path: string, headers: Record<string, string>): WebSocket {
  // `ws` ignores a `socketPath` option outside `ws+unix:` URLs (which cannot
  // spell a Windows pipe), so the connection is opened here.
  return new WebSocket(`ws://${IPC_HOST}${path}`, {
    headers,
    perMessageDeflate: false,
    createConnection: () => connect(socketPath),
  } as WebSocket.ClientOptions);
}

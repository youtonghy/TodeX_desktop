type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const DEBUG_ENABLED = __TODEX_BUILD_VERSION__ === 'DEV0.0.0';
let sequence = 0;

function summary(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length > 4096) return `${value.slice(0, 4096)}… [truncated ${value.length - 4096} chars]`;
    return value;
  }
  if (value instanceof ArrayBuffer) return `[array-buffer ${value.byteLength} bytes]`;
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength} bytes]`;
  if (value instanceof Blob) return `[blob ${value.size} bytes ${value.type || 'unknown'}]`;
  return value;
}

export function debugLog(event: string, data?: unknown, level: LogLevel = 'debug'): void {
  if (!DEBUG_ENABLED) return;
  try {
    window.todexDesktop.debug.log(level, event, data === undefined ? undefined : summary(data));
  } catch {
    // Diagnostics must never change application behavior.
  }
}

function installFetchTracing(): void {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestId = `fetch-${++sequence}`;
    const request = input instanceof Request ? input : null;
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : request?.url || String(input);
    const method = init?.method || request?.method || 'GET';
    const started = performance.now();
    debugLog('fetch.request', { requestId, url, method, hasBody: Boolean(init?.body || request?.body) });
    try {
      const response = await nativeFetch(input, init);
      debugLog('fetch.response', { requestId, url, method, status: response.status, ok: response.ok, durationMs: Math.round(performance.now() - started) }, response.ok ? 'debug' : 'warn');
      return response;
    } catch (error) {
      debugLog('fetch.error', { requestId, url, method, durationMs: Math.round(performance.now() - started), error }, 'error');
      throw error;
    }
  };
}

function installWebSocketTracing(): void {
  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket) return;
  const WrappedWebSocket = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    const socketId = `ws-${++sequence}`;
    debugLog('websocket.create', { socketId, url: String(url), protocols: protocols ? '[provided]' : undefined });
    const nativeSend = socket.send.bind(socket);
    socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      debugLog('websocket.send', { socketId, readyState: socket.readyState, data: summary(data) });
      return nativeSend(data);
    };
    socket.addEventListener('open', () => debugLog('websocket.open', { socketId }));
    socket.addEventListener('message', (event) => debugLog('websocket.message', { socketId, data: summary(event.data) }));
    socket.addEventListener('error', () => debugLog('websocket.error', { socketId }, 'error'));
    socket.addEventListener('close', (event) => debugLog('websocket.close', { socketId, code: event.code, reason: event.reason, wasClean: event.wasClean }));
    return socket;
  } as unknown as typeof WebSocket;
  Object.setPrototypeOf(WrappedWebSocket, NativeWebSocket);
  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  window.WebSocket = WrappedWebSocket;
}

export function installRendererDebugLogging(): void {
  if (!DEBUG_ENABLED) return;
  debugLog('renderer.start', {
    href: window.location.href,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
  }, 'info');
  installFetchTracing();
  installWebSocketTracing();
  window.addEventListener('error', (event) => debugLog('renderer.error', { message: event.message, filename: event.filename, line: event.lineno, column: event.colno, error: event.error }, 'error'));
  window.addEventListener('unhandledrejection', (event) => debugLog('renderer.unhandledRejection', { reason: event.reason }, 'error'));
  window.addEventListener('online', () => debugLog('renderer.online', undefined, 'info'));
  window.addEventListener('offline', () => debugLog('renderer.offline', undefined, 'warn'));
  window.addEventListener('focus', () => debugLog('renderer.focus'));
  window.addEventListener('blur', () => debugLog('renderer.blur'));
  document.addEventListener('visibilitychange', () => debugLog('renderer.visibility', { state: document.visibilityState }));
}

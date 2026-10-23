import { setIpcWebSocketImpl } from '@todex/protocol/ipcServerUrl';
import type { TodeXDesktopApi } from '../../preload/index';
import type { LocalSocketEvent } from '../../preload/localBackendTypes';

type SocketBridge = TodeXDesktopApi['localBackend']['socket'];

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * The subset of `WebSocket` the secure transport uses, carried over the main
 * process's relay to a backend socket (`todex-ipc://…`). Frames cross the
 * Electron IPC boundary as strings or `Uint8Array`s.
 */
class IpcWebSocket extends EventTarget {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;
  static bridge: SocketBridge | null = null;
  private static readonly byId = new Map<number, IpcWebSocket>();
  private static listening = false;

  readonly url: string;
  readonly protocol = '';
  readonly extensions = '';
  binaryType: BinaryType = 'blob';
  readyState = CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private id: number | null = null;
  private pendingClose: { code?: number; reason?: string } | null = null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    const bridge = IpcWebSocket.bridge;
    if (!bridge) throw new Error('local IPC sockets are unavailable');
    IpcWebSocket.listen(bridge);
    bridge.open(this.url).then((id) => {
      this.id = id;
      IpcWebSocket.byId.set(id, this);
      if (this.pendingClose) bridge.close(id, this.pendingClose.code, this.pendingClose.reason);
    }, (error: unknown) => {
      this.dispatch('error', new Event('error'));
      this.finish(1006, error instanceof Error ? error.message : '');
    });
  }

  private static listen(bridge: SocketBridge): void {
    if (IpcWebSocket.listening) return;
    IpcWebSocket.listening = true;
    bridge.onEvent((event: LocalSocketEvent) => IpcWebSocket.byId.get(event.id)?.receive(event));
  }

  private dispatch(type: 'open' | 'message' | 'error' | 'close', event: Event): void {
    const handler = { open: this.onopen, message: this.onmessage, error: this.onerror, close: this.onclose }[type] as ((event: Event) => void) | null;
    handler?.call(this, event);
    this.dispatchEvent(event);
  }

  private receive(event: LocalSocketEvent): void {
    if (event.type === 'open') {
      if (this.readyState !== CONNECTING) return;
      this.readyState = OPEN;
      this.dispatch('open', new Event('open'));
    } else if (event.type === 'message') {
      if (this.readyState !== OPEN) return;
      const data = event.text !== undefined
        ? event.text
        : this.binaryType === 'arraybuffer'
          ? (event.binary ?? new Uint8Array()).slice().buffer
          : new Blob([(event.binary ?? new Uint8Array()).slice()]);
      this.dispatch('message', new MessageEvent('message', { data }));
    } else if (event.type === 'error') {
      this.dispatch('error', new Event('error'));
    } else {
      this.finish(event.code, event.reason);
    }
  }

  private finish(code: number, reason: string): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    if (this.id !== null) IpcWebSocket.byId.delete(this.id);
    this.dispatch('close', new CloseEvent('close', { code, reason, wasClean: code === 1000 }));
  }

  get bufferedAmount(): number {
    return 0;
  }

  send(data: string | ArrayBufferLike | ArrayBufferView | Blob): void {
    if (this.readyState !== OPEN || this.id === null) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    const bridge = IpcWebSocket.bridge!;
    if (typeof data === 'string') bridge.send(this.id, data);
    else if (data instanceof Blob) throw new TypeError('Blob frames are not supported');
    else if (ArrayBuffer.isView(data)) bridge.send(this.id, new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice());
    else bridge.send(this.id, new Uint8Array(data).slice());
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === CLOSING || this.readyState === CLOSED) return;
    this.readyState = CLOSING;
    if (this.id === null) this.pendingClose = { code, reason };
    else IpcWebSocket.bridge!.close(this.id, code, reason);
  }
}

/** Lets the shared transport open `todex-ipc://` sockets through the desktop bridge. */
export function installIpcWebSocket(): void {
  const localBackend = window.todexDesktop?.localBackend;
  if (!localBackend?.available) return;
  IpcWebSocket.bridge = localBackend.socket;
  setIpcWebSocketImpl(IpcWebSocket as unknown as typeof WebSocket);
}

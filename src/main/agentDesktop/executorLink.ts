import type {
  AgentBrowserResult,
  ExecutorCapability,
  ExecutorInvokePayload,
} from '@todex/protocol/agentDesktop';
import { ConnectionError } from '@todex/protocol/connectionError';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { SocketVerificationError, verifyEncryptedSocket } from '@todex/protocol/socketVerification';
import { createTransportCryptoSession, type TransportCryptoSession } from '@todex/protocol/transportCrypto';
import { V2ApiClient, buildV2WebSocketUrlWithOptions } from '@todex/protocol/v2';
import type { ExecutorProfile } from './profiles';

/** The daemon closes frames over 8 MiB; leave room for the encryption envelope. */
const MAX_PLAINTEXT_FRAME = 6 * 1024 * 1024;
const REGISTER_TIMEOUT_MS = 10_000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
/** How often a backend with desktop tools off (or too old) is checked again. */
const SETTINGS_POLL_MS = 60_000;

/** A failure the executor reports to the daemon with a stable code. */
export class ExecutorFailure extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExecutorFailure';
    this.code = code;
  }
}

export interface ExecutorHandlers {
  capabilities: ExecutorCapability[];
  invoke(profileId: string, payload: ExecutorInvokePayload, signal: AbortSignal): Promise<AgentBrowserResult>;
  release(profileId: string, conversationId: string): void;
  /** Frames other than executor ones (`tunnel.*`). */
  frame?(profileId: string, type: string, payload: Record<string, unknown>): void;
  /** The connection dropped; anything bound to it is gone. */
  disconnected?(profileId: string): void;
}

export type ExecutorLogger = (level: 'debug' | 'info' | 'warn' | 'error', event: string, data?: unknown) => void;

export type ExecutorStatus = 'idle' | 'disabled' | 'unsupported' | 'connecting' | 'online' | 'retrying';

/**
 * One backend's executor connection: a dedicated, encrypted and
 * device-signed `/v2/ws` socket, independent of the renderer's UI socket.
 */
export class ExecutorLink {
  private stopped = false;
  private socket: WebSocket | null = null;
  private crypto: TransportCryptoSession | null = null;
  private wake: (() => void) | null = null;
  private readonly pending = new Map<string, AbortController>();
  status: ExecutorStatus = 'idle';

  constructor(
    readonly profile: ExecutorProfile,
    private readonly handlers: ExecutorHandlers,
    private readonly log: ExecutorLogger,
  ) {}

  start(): void {
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.wake?.();
    this.socket?.close();
  }

  /** Re-check the backend now (e.g. after the user switched tools on). */
  refresh(): void {
    this.wake?.();
  }

  /** Sends a frame on the live connection; false when there is none or it is too large. */
  send(type: string, payload: unknown, id?: string): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    const text = JSON.stringify(id ? { id, type, payload } : { type, payload });
    // Checked before encrypting: a refused frame must not consume a nonce,
    // or every later frame on this socket would be rejected as out of order.
    if (text.length > MAX_PLAINTEXT_FRAME) return false;
    socket.send(this.crypto ? this.crypto.encryptClientText(text) : text);
    return true;
  }

  private async run(): Promise<void> {
    let backoff = MIN_BACKOFF_MS;
    while (!this.stopped) {
      let delay = backoff;
      try {
        const enabled = await this.desktopToolsEnabled();
        if (!enabled) {
          delay = SETTINGS_POLL_MS;
        } else {
          this.status = 'connecting';
          const registered = await this.connectOnce();
          if (registered) backoff = MIN_BACKOFF_MS;
          delay = backoff;
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          if (!this.stopped) this.status = 'retrying';
        }
      } catch (error) {
        this.status = 'retrying';
        this.log('warn', 'agentDesktop.executor.error', { profileId: this.profile.id, error: String(error) });
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
      if (this.stopped) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        this.wake = () => { clearTimeout(timer); resolve(); };
      });
      this.wake = null;
    }
    this.status = 'idle';
  }

  private async desktopToolsEnabled(): Promise<boolean> {
    const api = new V2ApiClient({ serverUrl: this.profile.serverUrl, device: deviceIdentityFromSecret(this.profile.deviceSecret) });
    try {
      const settings = await api.getAgentDesktop();
      this.status = settings.enabled ? this.status : 'disabled';
      return settings.enabled;
    } catch (error) {
      if (error instanceof ConnectionError && error.httpStatus === 404) {
        this.status = 'unsupported';
        return false;
      }
      throw error;
    }
  }

  /** Resolves when the connection ends; true if it registered first. */
  private connectOnce(): Promise<boolean> {
    return new Promise((resolve) => {
      let registered = false;
      const crypto = createTransportCryptoSession(this.profile);
      const device = deviceIdentityFromSecret(this.profile.deviceSecret);
      const socket = new WebSocket(buildV2WebSocketUrlWithOptions(this.profile.serverUrl, {
        cryptoQueryString: crypto?.queryString,
        device,
      }));
      this.socket = socket;
      this.crypto = crypto;
      const registerId = `executor-register-${globalThis.crypto.randomUUID()}`;
      let registerTimer: ReturnType<typeof setTimeout> | null = null;
      let verifying = Boolean(crypto);

      socket.addEventListener('open', async () => {
        if (crypto) {
          try {
            await verifyEncryptedSocket(socket, crypto);
          } catch (error) {
            this.log('warn', 'agentDesktop.executor.verifyFailed', {
              profileId: this.profile.id,
              retryable: error instanceof SocketVerificationError ? error.retryable : true,
            });
            socket.close();
            return;
          }
          verifying = false;
        }
        this.send('executor.register', { capabilities: this.handlers.capabilities, platform: process.platform }, registerId);
        registerTimer = setTimeout(() => socket.close(), REGISTER_TIMEOUT_MS);
      });
      socket.addEventListener('message', (event: MessageEvent) => {
        if (verifying) return; // the verifier consumes the handshake reply
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(crypto ? crypto.decryptServerText(String(event.data)) : String(event.data));
        } catch (error) {
          this.log('warn', 'agentDesktop.executor.badFrame', { profileId: this.profile.id, error: String(error) });
          return;
        }
        if (frame.id === registerId) {
          if (registerTimer) clearTimeout(registerTimer);
          if (frame.type === 'server.result') {
            registered = true;
            this.status = 'online';
            this.log('info', 'agentDesktop.executor.online', { profileId: this.profile.id });
          } else {
            this.log('warn', 'agentDesktop.executor.registerFailed', { profileId: this.profile.id, frame });
            socket.close();
          }
          return;
        }
        this.dispatch(frame);
      });
      const finish = () => {
        if (registerTimer) clearTimeout(registerTimer);
        if (this.socket === socket) {
          this.socket = null;
          this.crypto = null;
        }
        for (const controller of this.pending.values()) controller.abort();
        this.pending.clear();
        if (registered) this.handlers.disconnected?.(this.profile.id);
        resolve(registered);
      };
      socket.addEventListener('close', finish, { once: true });
      socket.addEventListener('error', () => socket.close());
    });
  }

  private dispatch(frame: Record<string, unknown>): void {
    const type = typeof frame.type === 'string' ? frame.type : '';
    const payload = (frame.payload && typeof frame.payload === 'object' ? frame.payload : {}) as Record<string, unknown>;
    switch (type) {
      case 'executor.invoke':
        void this.invoke(payload as unknown as ExecutorInvokePayload);
        return;
      case 'executor.cancel':
        this.pending.get(String(payload.invokeId))?.abort();
        return;
      case 'executor.release':
        this.handlers.release(this.profile.id, String(payload.conversationId));
        return;
      case 'server.error':
        this.log('warn', 'agentDesktop.executor.serverError', { profileId: this.profile.id, payload });
        return;
      default:
        if (type.startsWith('tunnel.')) this.handlers.frame?.(this.profile.id, type, payload);
    }
  }

  private async invoke(payload: ExecutorInvokePayload): Promise<void> {
    const controller = new AbortController();
    this.pending.set(payload.invokeId, controller);
    try {
      const result = await this.handlers.invoke(this.profile.id, payload, controller.signal);
      if (controller.signal.aborted) return;
      if (!this.send('executor.result', { invokeId: payload.invokeId, ok: true, result })) {
        this.send('executor.result', {
          invokeId: payload.invokeId,
          ok: false,
          error: { code: 'EXECUTOR_FAILED', message: 'the result was too large to return' },
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = error instanceof ExecutorFailure
        ? { code: error.code, message: error.message }
        : { code: 'EXECUTOR_FAILED', message: error instanceof Error ? error.message : String(error) };
      this.send('executor.result', { invokeId: payload.invokeId, ok: false, error: failure });
    } finally {
      this.pending.delete(payload.invokeId);
    }
  }
}

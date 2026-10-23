import { existsSync, readdirSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, ipcMain, protocol, session, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type WebSocket from 'ws';
import { BackendBinaries, binaryVersion, matchingBackendVersion, platformLabel } from './binary';
import { autostartEnabled, daemonCommand, daemonStatus, dockerInstances, dockerPairApprove, setAutostart, type DaemonStatus, type DockerInstance } from './cli';
import { LOCAL_ADMIN_PREFIX, isLocalAdminPath } from './adminPath';
import { socketFetch, socketJson, socketWebSocket } from './socketHttp';

export const IPC_SCHEME = 'todex-ipc';
export const LOCAL_INSTANCE = 'local';
const PAIRING_CREATE_PATH = '/v2/device-pairing/create';
const LOG_TAIL_BYTES = 64 * 1024;
const VERIFICATION_CODE = /^[0-9a-z]{4}-?[0-9a-z]{4}$/i;

/** Must run before `app` is ready: `todex-ipc://` behaves like an HTTPS
 * origin that `fetch` (streaming bodies included) and CORS work with. */
export function registerIpcScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: IPC_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);
}

export type LocalBackendHost = {
  buildVersion: string;
  /** Origin the renderer presents to backends (anonymous loopback backends check it). */
  appOrigin: string;
  isRendererOrigin(origin: string): boolean;
  isRendererUrl(url: string): boolean;
  stopOnQuit(): boolean;
  log(level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>): void;
};

type ContainerInstance = { id: string; name: string; socketPath: string };

export type LocalAdminStatus = Record<string, unknown> & { version?: string; deployment?: string };

export type NativeState = {
  dataDir: string;
  platformSupported: boolean;
  expectedVersion: string | null;
  binary: { path: string; version: string | null; managed: boolean } | null;
  managedVersions: string[];
  daemon: DaemonStatus | null;
  /** Why `daemon status --format json` failed (a backend without IPC support), else null. */
  statusError: string | null;
  ipcPath: string | null;
  admin: LocalAdminStatus | null;
  adminError: string | null;
  autostart: boolean | null;
};

export type ContainerState = {
  id: string;
  name: string;
  socketPath: string | null;
  container: string | null;
  admin: LocalAdminStatus | null;
  adminError: string | null;
};

export type DiscoverResult = { desktopVersion: string; native: NativeState; containers: ContainerState[] };

function defaultDataDir(): string {
  return join(homedir(), '.todex-agent');
}

function containerConfigRoot(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return join(xdg && xdg.startsWith('/') ? xdg : join(homedir(), '.config'), 'todex-container');
}

function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

/** Containers that `todexc` (or the default compose file) started with the
 * host-shared IPC directory (Linux only: Docker Desktop cannot share sockets). */
function scanContainerSockets(): ContainerInstance[] {
  if (process.platform !== 'linux') return [];
  const root = containerConfigRoot();
  if (!existsSync(root)) return [];
  const found: ContainerInstance[] = [];
  for (const name of readdirSync(root)) {
    const socketPath = join(root, name, 'ipc', 'agentd.sock');
    const id = `container-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 64).replace(/-+$/, '');
    if (isSocket(socketPath)) found.push({ id, name, socketPath });
  }
  return found;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': '*',
    'access-control-max-age': '600',
  };
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'origin', 'cookie', 'referer']);

export class LocalBackendManager {
  private readonly binaries = new BackendBinaries(join(app.getPath('userData'), 'backend', 'bin'));
  private readonly dataDir = defaultDataDir();
  private nativeIpcPath: string | null = null;
  private containers = new Map<string, ContainerInstance>();
  private dockerContainers: DockerInstance[] = [];
  /** Pairing requests this app created over IPC: only these may be approved without the user. */
  private readonly ownPairings = new Map<string, { instance: string; expiresAt: number }>();
  private readonly sockets = new Map<number, { socket: WebSocket; owner: WebContents }>();
  private nextSocketId = 1;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly host: LocalBackendHost) {}

  // ---- instance → socket ------------------------------------------------

  private socketFor(instance: string): string {
    if (instance === LOCAL_INSTANCE) {
      const path = this.nativeIpcPath ?? (process.platform === 'win32' ? null : join(this.dataDir, 'agentd.sock'));
      if (path) return path;
    } else {
      const container = this.containers.get(instance);
      if (container) return container.socketPath;
    }
    throw Object.assign(new Error(`local backend ${instance} is not available`), { code: 'instance_unavailable' });
  }

  private async refreshInstances(): Promise<void> {
    this.containers = new Map(scanContainerSockets().map((item) => [item.id, item]));
  }

  // ---- renderer transport ------------------------------------------------

  installProtocol(): void {
    session.defaultSession.protocol.handle(IPC_SCHEME, (request) => this.handleRequest(request));
  }

  private async handleRequest(request: Request): Promise<Response> {
    const initiator = (request as Request & { initiatorOrigin?: string }).initiatorOrigin;
    if (!initiator || !this.host.isRendererOrigin(initiator)) {
      this.host.log('warn', 'localBackend.protocol.refused', { initiator: initiator ?? null });
      return new Response('forbidden', { status: 403 });
    }
    // CORS compares against the Origin the request carried (`null` for a `file://` page).
    const cors = corsHeaders(request.headers.get('origin') ?? initiator);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    // The renderer reaches the local-admin API only through the IPC handlers below.
    if (isLocalAdminPath(url.pathname)) {
      return new Response('not found', { status: 404, headers: cors });
    }
    let socketPath: string;
    try {
      await this.ensureResolved(url.hostname);
      socketPath = this.socketFor(url.hostname);
    } catch (error) {
      return new Response(errorMessage(error), { status: 502, headers: cors });
    }
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
    });
    headers.origin = this.host.appOrigin;
    let response: Response;
    try {
      response = await socketFetch(socketPath, {
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
        signal: request.signal,
      });
    } catch (error) {
      return new Response(errorMessage(error), { status: 502, headers: cors });
    }
    const outHeaders = new Headers(response.headers);
    for (const name of [...outHeaders.keys()]) {
      if (name.startsWith('access-control-')) outHeaders.delete(name);
    }
    for (const [name, value] of Object.entries(cors)) outHeaders.set(name, value);
    if (request.method === 'POST' && url.pathname === PAIRING_CREATE_PATH && response.ok) {
      const text = await response.text();
      this.rememberPairing(url.hostname, text);
      return new Response(text, { status: response.status, headers: outHeaders });
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outHeaders });
  }

  /** `fetch` for `todex-ipc://` URLs requested by the main process itself (the preview forwarder). */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (isLocalAdminPath(url.pathname)) throw new Error('forbidden');
    await this.ensureResolved(url.hostname);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
    });
    headers.origin = this.host.appOrigin;
    return socketFetch(this.socketFor(url.hostname), {
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : new Uint8Array(await request.arrayBuffer()),
      signal: init?.signal ?? undefined,
    });
  }) as typeof fetch;

  private rememberPairing(instance: string, body: string): void {
    try {
      const { requestId, expiresAt } = JSON.parse(body) as { requestId?: unknown; expiresAt?: unknown };
      if (typeof requestId === 'string' && typeof expiresAt === 'number') this.ownPairings.set(requestId, { instance, expiresAt });
    } catch {
      // The renderer rejects malformed responses itself.
    }
    const now = Date.now();
    for (const [id, entry] of this.ownPairings) if (entry.expiresAt < now) this.ownPairings.delete(id);
  }

  /** Resolves the socket of `instance` on first use (e.g. a container started after the last scan). */
  private async ensureResolved(instance: string): Promise<void> {
    if (instance === LOCAL_INSTANCE) {
      if (!this.nativeIpcPath) await this.refreshNativeIpcPath();
      return;
    }
    if (!this.containers.has(instance)) await this.refreshInstances();
  }

  private async refreshNativeIpcPath(): Promise<void> {
    const binary = await this.currentBinary(null);
    if (!binary) return;
    try {
      const status = await daemonStatus(binary.path, this.dataDir);
      if (status.ipcPath) this.nativeIpcPath = status.ipcPath;
    } catch (error) {
      this.host.log('warn', 'localBackend.status.failed', { error: errorMessage(error) });
    }
  }

  private wsOpen(event: IpcMainInvokeEvent, rawUrl: unknown): number {
    if (!event.senderFrame || !this.host.isRendererUrl(event.senderFrame.url)) throw new Error('forbidden');
    if (typeof rawUrl !== 'string') throw new TypeError('url');
    const url = new URL(rawUrl);
    if (url.protocol !== `${IPC_SCHEME}:`) throw new TypeError('not an IPC backend URL');
    if (isLocalAdminPath(url.pathname)) throw new Error('forbidden');
    const id = this.nextSocketId++;
    const owner = event.sender;
    const emit = (payload: Record<string, unknown>) => {
      if (!owner.isDestroyed()) owner.send('localBackend:wsEvent', { id, ...payload });
    };
    const start = async () => {
      await this.ensureResolved(url.hostname);
      const socket = socketWebSocket(this.socketFor(url.hostname), `${url.pathname}${url.search}`, { origin: this.host.appOrigin });
      this.sockets.set(id, { socket, owner });
      socket.on('open', () => emit({ type: 'open' }));
      socket.on('message', (data, isBinary) => {
        const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        emit(isBinary ? { type: 'message', binary: new Uint8Array(buffer) } : { type: 'message', text: buffer.toString('utf8') });
      });
      socket.on('error', (error) => emit({ type: 'error', message: error.message }));
      socket.on('close', (code, reason) => {
        this.sockets.delete(id);
        emit({ type: 'close', code, reason: reason.toString('utf8') });
      });
    };
    start().catch((error) => {
      emit({ type: 'error', message: errorMessage(error) });
      emit({ type: 'close', code: 1006, reason: '' });
    });
    owner.once('destroyed', () => this.sockets.get(id)?.socket.terminate());
    return id;
  }

  private wsSend(event: IpcMainEvent, id: unknown, data: unknown): void {
    const entry = typeof id === 'number' ? this.sockets.get(id) : undefined;
    if (!entry || entry.owner !== event.sender) return;
    if (typeof data === 'string') entry.socket.send(data);
    else if (data instanceof Uint8Array) entry.socket.send(data, { binary: true });
  }

  private wsClose(event: IpcMainEvent, id: unknown, code: unknown, reason: unknown): void {
    const entry = typeof id === 'number' ? this.sockets.get(id) : undefined;
    if (!entry || entry.owner !== event.sender) return;
    const validCode = typeof code === 'number' && (code === 1000 || (code >= 3000 && code <= 4999)) ? code : 1000;
    entry.socket.close(validCode, typeof reason === 'string' ? reason.slice(0, 120) : undefined);
  }

  // ---- native instance ---------------------------------------------------

  private expectedVersion(): string | null {
    return matchingBackendVersion(this.host.buildVersion);
  }

  /** The binary that runs (or would run) the native backend: the running
   * daemon's executable, else the managed build matching this desktop, else
   * the newest managed build, else a user-installed `todex-agentd`. */
  private async currentBinary(daemon: DaemonStatus | null): Promise<NativeState['binary']> {
    const managedRoot = join(app.getPath('userData'), 'backend', 'bin');
    const candidates: string[] = [];
    if (daemon?.executable) candidates.push(daemon.executable);
    const expected = this.expectedVersion();
    if (expected) candidates.push(this.binaries.managedPath(expected));
    const versions = this.binaries.installedVersions().sort(compareVersions).reverse();
    candidates.push(...versions.map((version) => this.binaries.managedPath(version)));
    const user = await this.binaries.findUserBinary();
    if (user) candidates.push(user);
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      return { path, version: await binaryVersion(path), managed: path.startsWith(managedRoot) };
    }
    return null;
  }

  private async adminStatus(socketPath: string | null): Promise<{ admin: LocalAdminStatus | null; adminError: string | null }> {
    if (!socketPath) return { admin: null, adminError: null };
    try {
      return { admin: await socketJson<LocalAdminStatus>(socketPath, 'GET', `${LOCAL_ADMIN_PREFIX}/status`, undefined, 4000), adminError: null };
    } catch (error) {
      return { admin: null, adminError: errorMessage(error) };
    }
  }

  async discover(): Promise<DiscoverResult> {
    let binary = await this.currentBinary(null);
    let daemon: DaemonStatus | null = null;
    let statusError: string | null = null;
    if (binary) {
      try {
        daemon = await daemonStatus(binary.path, this.dataDir);
      } catch (error) {
        // Backends from before the IPC listener have no `--format json`.
        statusError = errorMessage(error);
        this.host.log('warn', 'localBackend.status.failed', { error: statusError });
      }
      if (daemon?.executable && daemon.executable !== binary.path) binary = await this.currentBinary(daemon);
    }
    this.nativeIpcPath = daemon?.running ? daemon.ipcPath : null;
    const { admin, adminError } = await this.adminStatus(this.nativeIpcPath);
    let autostart: boolean | null = null;
    if (binary) {
      try {
        autostart = await autostartEnabled(binary.path);
      } catch {
        autostart = null;
      }
    }
    await this.refreshInstances();
    this.dockerContainers = await dockerInstances();
    const containers: ContainerState[] = [];
    for (const item of this.containers.values()) {
      const docker = this.dockerContainers.find((entry) => entry.instance === item.name);
      containers.push({ id: item.id, name: item.name, socketPath: item.socketPath, container: docker?.container ?? null, ...await this.adminStatus(item.socketPath) });
    }
    for (const docker of this.dockerContainers) {
      if (containers.some((entry) => entry.name === docker.instance)) continue;
      containers.push({ id: `docker-${docker.container}`, name: docker.instance, socketPath: null, container: docker.container, admin: null, adminError: null });
    }
    return {
      desktopVersion: this.host.buildVersion,
      native: {
        dataDir: this.dataDir,
        platformSupported: platformLabel() !== null,
        expectedVersion: this.expectedVersion(),
        binary,
        managedVersions: this.binaries.installedVersions(),
        daemon,
        statusError,
        ipcPath: this.nativeIpcPath,
        admin,
        adminError,
        autostart,
      },
      containers,
    };
  }

  /** One lifecycle operation at a time: `daemon start` and an install must not race. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.busy.then(task, task);
    this.busy = run.catch(() => undefined);
    return run;
  }

  private async requireBinary(): Promise<string> {
    const binary = await this.currentBinary(null);
    if (!binary) throw Object.assign(new Error('todex-agentd is not installed'), { code: 'not_installed' });
    return binary.path;
  }

  /** Installs the backend build matching this desktop (latest for dev builds). */
  install(sender: WebContents): Promise<string> {
    return this.exclusive(async () => {
      const version = await this.binaries.resolveVersion(this.host.buildVersion);
      if (this.binaries.installedVersions().includes(version)) return this.binaries.managedPath(version);
      const path = await this.binaries.install(version, (received, total) => {
        if (!sender.isDestroyed()) sender.send('localBackend:progress', { version, received, total });
      });
      this.host.log('info', 'localBackend.installed', { version });
      return path;
    });
  }

  /** Starts the daemon with the desktop's matching build and pins it (no self-update). */
  start(): Promise<void> {
    return this.exclusive(async () => {
      const expected = this.expectedVersion();
      const managed = expected ? this.binaries.managedPath(expected) : null;
      const binary = managed && existsSync(managed) ? managed : await this.requireBinary();
      await daemonCommand(binary, this.dataDir, 'start');
      await this.afterStart(binary);
    });
  }

  stop(): Promise<void> {
    return this.exclusive(async () => {
      await daemonCommand(await this.requireBinary(), this.dataDir, 'stop');
      this.nativeIpcPath = null;
    });
  }

  restart(): Promise<void> {
    return this.exclusive(async () => {
      const binary = await this.requireBinary();
      await daemonCommand(binary, this.dataDir, 'restart');
      await this.afterStart(binary);
    });
  }

  /** Stops the running daemon and starts it again from the managed build of this desktop's version. */
  switchToMatchingVersion(sender: WebContents): Promise<void> {
    return this.install(sender).then((binary) => this.exclusive(async () => {
      const running = await this.currentBinary(null);
      if (running) {
        try {
          await daemonCommand(running.path, this.dataDir, 'stop');
        } catch (error) {
          this.host.log('warn', 'localBackend.switch.stopFailed', { error: errorMessage(error) });
        }
      }
      await daemonCommand(binary, this.dataDir, 'start');
      await this.afterStart(binary);
      const enabled = await autostartEnabled(binary).catch(() => false);
      // The login entry records the executable; point it at the new build.
      if (enabled) await setAutostart(binary, this.dataDir, true);
      const keep = [this.expectedVersion(), running?.version].filter((value): value is string => Boolean(value));
      await this.binaries.prune(keep);
    }));
  }

  private async afterStart(binary: string): Promise<void> {
    this.nativeIpcPath = null;
    await this.refreshNativeIpcPath();
    const managed = binary.startsWith(join(app.getPath('userData'), 'backend', 'bin'));
    if (!managed || !this.nativeIpcPath) return;
    // The desktop keeps its backend on its own version; the backend's 6-hourly self-update would drift.
    try {
      await socketJson(this.nativeIpcPath, 'PUT', `${LOCAL_ADMIN_PREFIX}/config`, { autoUpdate: false });
    } catch (error) {
      this.host.log('warn', 'localBackend.pinVersion.failed', { error: errorMessage(error) });
    }
  }

  setAutostart(enabled: boolean): Promise<void> {
    return this.exclusive(async () => setAutostart(await this.requireBinary(), this.dataDir, enabled));
  }

  async logTail(): Promise<string> {
    const path = join(this.dataDir, 'logs', 'todex-agentd-daemon.log');
    if (!existsSync(path)) return '';
    const handle = await open(path, 'r');
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, LOG_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  }

  async stopForQuit(): Promise<void> {
    if (!this.host.stopOnQuit()) return;
    const binary = await this.currentBinary(null);
    if (!binary) return;
    const status = await daemonStatus(binary.path, this.dataDir).catch(() => null);
    if (status?.running) await daemonCommand(binary.path, this.dataDir, 'stop');
  }

  // ---- local-admin API -------------------------------------------------

  private async admin<T>(instance: unknown, method: string, path: string, body?: unknown): Promise<T> {
    if (typeof instance !== 'string') throw new TypeError('instance');
    await this.ensureResolved(instance);
    return socketJson<T>(this.socketFor(instance), method, `${LOCAL_ADMIN_PREFIX}${path}`, body);
  }

  /** Approves a pairing request this app itself created over IPC. */
  async approveOwnPairing(instance: unknown, requestId: unknown, verificationCode: unknown): Promise<void> {
    if (typeof requestId !== 'string' || typeof verificationCode !== 'string') throw new TypeError('request');
    const own = this.ownPairings.get(requestId);
    if (!own || own.instance !== instance || own.expiresAt < Date.now()) throw new Error('not a pairing request this app created');
    this.ownPairings.delete(requestId);
    await this.admin(instance, 'POST', `/pairing-requests/${encodeURIComponent(requestId)}/decision`, { approved: true, verificationCode });
  }

  /** `pair approve` inside a running TodeX container that has no shared socket (Docker Desktop). */
  async dockerApprove(container: unknown, verificationCode: unknown): Promise<void> {
    if (typeof container !== 'string' || typeof verificationCode !== 'string' || !VERIFICATION_CODE.test(verificationCode)) throw new TypeError('request');
    if (!this.dockerContainers.length) this.dockerContainers = await dockerInstances();
    if (!this.dockerContainers.some((entry) => entry.container === container)) throw new Error(`${container} is not a running TodeX container`);
    await dockerPairApprove(container, verificationCode);
  }

  register(handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => void): void {
    handle('localBackend:discover', () => this.discover());
    handle('localBackend:install', (event) => this.install(event.sender));
    handle('localBackend:start', () => this.start());
    handle('localBackend:stop', () => this.stop());
    handle('localBackend:restart', () => this.restart());
    handle('localBackend:switchVersion', (event) => this.switchToMatchingVersion(event.sender));
    handle('localBackend:setAutostart', (_event, enabled: unknown) => this.setAutostart(enabled === true));
    handle('localBackend:logTail', () => this.logTail());
    handle('localBackend:status', (_event, instance) => this.admin(instance, 'GET', '/status'));
    handle('localBackend:getConfig', (_event, instance) => this.admin(instance, 'GET', '/config'));
    handle('localBackend:setConfig', (_event, instance, patch: unknown) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch');
      return this.admin(instance, 'PUT', '/config', patch);
    });
    handle('localBackend:pairingRequests', (_event, instance) => this.admin(instance, 'GET', '/pairing-requests'));
    handle('localBackend:decidePairing', (_event, instance, requestId: unknown, approved: unknown, verificationCode: unknown) => {
      if (typeof requestId !== 'string' || typeof verificationCode !== 'string') throw new TypeError('request');
      return this.admin(instance, 'POST', `/pairing-requests/${encodeURIComponent(requestId)}/decision`, { approved: approved === true, verificationCode });
    });
    handle('localBackend:devices', (_event, instance) => this.admin(instance, 'GET', '/devices'));
    handle('localBackend:revokeDevice', (_event, instance, deviceId: unknown) => {
      if (typeof deviceId !== 'string' || !deviceId) throw new TypeError('deviceId');
      return this.admin(instance, 'DELETE', `/devices/${encodeURIComponent(deviceId)}`);
    });
    handle('localBackend:reset', (_event, instance, target: unknown) => {
      if (target !== 'devices' && target !== 'encryption') throw new TypeError('target');
      return this.admin(instance, 'POST', '/reset', { target });
    });
    handle('localBackend:approveOwnPairing', (_event, instance, requestId, code) => this.approveOwnPairing(instance, requestId, code));
    handle('localBackend:dockerApprove', (_event, container, code) => this.dockerApprove(container, code));
    handle('localBackend:dockerContainers', async () => {
      this.dockerContainers = await dockerInstances();
      return this.dockerContainers;
    });
    handle('localBackend:wsOpen', (event, url) => this.wsOpen(event, url));
    ipcMain.on('localBackend:wsSend', (event, id, data) => this.wsSend(event, id, data));
    ipcMain.on('localBackend:wsClose', (event, id, code, reason) => this.wsClose(event, id, code, reason));
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

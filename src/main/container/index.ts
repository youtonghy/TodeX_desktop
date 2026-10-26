import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import {
  DockerError,
  detectEnvironment,
  imagesInUse,
  inspectTodexContainers,
  runDocker,
  todexImages,
  type DockerEnvironment,
  type InspectedContainer,
} from './docker.ts';
import {
  DEFAULT_IMAGE,
  DEFAULT_PORT,
  backendPathFor,
  configRoot,
  containerName,
  defaultSettings,
  ipcInstanceId,
  isInstanceName,
  mountCovering,
  mountTargetFor,
  readInstance,
  writeInstance,
  type InstanceFiles,
  type InstanceMount,
  type InstanceSettings,
} from './instance.ts';

/** Preferences of Settings → TodeX Container (renderer store key, read here for cleanup). */
export const CONTAINER_PREFS_KEY = 'todex.desktop.container.v1';
export type ContainerPrefs = { cleanupImages?: boolean; removeStoppedDays?: number; pruneMounts?: boolean; stopOnQuit?: boolean };

const HEALTH_TIMEOUT_MS = 180_000;
const CLEANUP_FIRST_DELAY_MS = 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Pulls of a 1–1.5 GB image on a slow link.
const UP_TIMEOUT_MS = 30 * 60 * 1000;

export type ContainerHost = {
  prefs(): ContainerPrefs;
  log(level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>): void;
};

/** One TodeX container instance as the settings page shows it. */
export type ContainerInfo = {
  name: string;
  /** Has a todexc instance directory: Desktop can recreate, remount, upgrade and remove it. */
  managed: boolean;
  /** Created by Desktop (stopped on quit when asked). */
  desktop: boolean;
  container: string | null;
  /** Docker's state, or `removed` when only the instance directory is left. */
  state: string;
  health: InspectedContainer['health'];
  image: string | null;
  listen: string | null;
  port: number | null;
  mounts: InstanceMount[];
  sshAgent: boolean;
  /** The shared local socket, when present. */
  socketPath: string | null;
  /** The local-backend IPC instance serving that socket. */
  ipcInstance: string | null;
  /** The IPC instance id this container's socket has whenever it is shared (its profile may outlive the socket). */
  ipcId: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ContainerProgress = { name: string; phase: 'pull' | 'start' | 'wait' | 'stop' | 'remove'; line?: string };

export type MountResult = { target: string; backendPath: string; recreated: boolean };

function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export class ContainerManager {
  private readonly root = configRoot(process.env, homedir());
  private readonly locks = new Map<string, Promise<unknown>>();
  private environmentCache: DockerEnvironment | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private sender: WebContents | null = null;

  constructor(private readonly host: ContainerHost) {}

  // ---- reading ----------------------------------------------------------------

  async environment(refresh = false): Promise<DockerEnvironment> {
    if (refresh || !this.environmentCache) this.environmentCache = await detectEnvironment();
    return this.environmentCache;
  }

  private ids(): { uid: string; gid: string } {
    const uid = process.getuid?.() ?? 1000;
    const gid = process.getgid?.() ?? 1000;
    return { uid: String(uid), gid: String(gid) };
  }

  private defaults(): InstanceSettings {
    const { uid, gid } = this.ids();
    return defaultSettings(uid, gid);
  }

  private instances(): InstanceFiles[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).flatMap((name) => {
      try {
        const instance = readInstance(this.root, name, this.defaults());
        return instance ? [instance] : [];
      } catch (error) {
        this.host.log('warn', 'container.instance.unreadable', { name, error: errorMessage(error) });
        return [];
      }
    });
  }

  private instance(name: string): InstanceFiles {
    if (!isInstanceName(name)) throw new TypeError('name');
    const instance = readInstance(this.root, name, this.defaults());
    if (!instance) throw Object.assign(new Error(`${name} is not managed by TodeX (no todexc instance directory)`), { code: 'unmanaged' });
    return instance;
  }

  private ipcDir(name: string): string {
    return join(this.root, name, 'ipc');
  }

  async list(): Promise<ContainerInfo[]> {
    const env = await this.environment();
    const inspected = env.problem ? [] : await inspectTodexContainers().catch((error) => {
      this.host.log('warn', 'container.inspect.failed', { error: errorMessage(error) });
      return [] as InspectedContainer[];
    });
    const result: ContainerInfo[] = [];
    for (const instance of this.instances()) {
      const container = inspected.find((item) => item.instance === instance.name);
      const socketPath = join(this.ipcDir(instance.name), 'agentd.sock');
      const shared = process.platform === 'linux' && container?.state === 'running' && isSocket(socketPath);
      result.push({
        name: instance.name,
        managed: true,
        desktop: instance.desktop,
        container: container?.name ?? null,
        state: container?.state ?? 'removed',
        health: container?.health ?? null,
        image: container?.image ?? `${instance.settings.image}:${instance.settings.tag}`,
        listen: instance.settings.listen,
        port: instance.settings.port,
        mounts: instance.mounts,
        sshAgent: instance.settings.sshAgent,
        socketPath: shared ? socketPath : null,
        ipcInstance: shared ? ipcInstanceId(instance.name) : null,
        ipcId: ipcInstanceId(instance.name),
        startedAt: container?.startedAt ?? null,
        finishedAt: container?.finishedAt ?? null,
      });
    }
    for (const container of inspected) {
      if (result.some((item) => item.name === container.instance)) continue;
      result.push({
        name: container.instance,
        managed: false,
        desktop: false,
        container: container.name,
        state: container.state,
        health: container.health,
        image: container.image,
        listen: container.ports[0]?.hostIp ?? null,
        port: container.ports[0]?.hostPort ?? null,
        mounts: container.binds,
        sshAgent: false,
        socketPath: null,
        ipcInstance: null,
        ipcId: ipcInstanceId(container.instance),
        startedAt: container.startedAt,
        finishedAt: container.finishedAt,
      });
    }
    return result.sort((left, right) => left.name.localeCompare(right.name));
  }

  async logs(name: string): Promise<string> {
    const container = (await this.list()).find((item) => item.name === name)?.container;
    if (!container) throw new Error(`${name} has no container`);
    const lines: string[] = [];
    await runDocker(['logs', '--tail', '500', container], { timeoutMs: 15_000, onLine: (line) => lines.push(line) });
    return lines.join('\n');
  }

  // ---- lifecycle ------------------------------------------------------------

  private exclusive<T>(name: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.catch(() => undefined);
    this.locks.set(name, settled);
    void settled.then(() => {
      if (this.locks.get(name) === settled) this.locks.delete(name);
    });
    return run;
  }

  private progress(event: ContainerProgress): void {
    if (this.sender && !this.sender.isDestroyed()) this.sender.send('container:progress', event);
  }

  private async requireDocker(): Promise<void> {
    const env = await this.environment(true);
    if (env.problem) throw new DockerError(env.problemDetail ?? `docker: ${env.problem}`, env.problem);
    if (!env.composeVersion) throw new Error('Docker Compose v2 (`docker compose`) is required');
  }

  private composeFile(name: string): string {
    return join(this.root, name, 'compose.yaml');
  }

  private compose(name: string, args: string[], phase: ContainerProgress['phase'], timeoutMs = 120_000): Promise<string> {
    return runDocker(['compose', '-f', this.composeFile(name), ...args], {
      timeoutMs,
      onLine: (line) => this.progress({ name, phase, line }),
    });
  }

  /** The socket directory must belong to this user: the daemon runs with the same UID and only accepts it. */
  private prepareIpcDir(name: string): string | null {
    if (process.platform !== 'linux') return null;
    const dir = this.ipcDir(name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (statSync(dir).uid !== process.getuid?.()) throw new Error(`${dir} is not owned by you; remove it and try again`);
    chmodSync(dir, 0o700);
    // sun_path holds 108 bytes including the terminator.
    if (dir.length > 95) this.host.log('warn', 'container.ipc.pathTooLong', { dir });
    return dir;
  }

  private sshAgentSocket(settings: InstanceSettings): string | null {
    if (!settings.sshAgent) return null;
    if (process.platform === 'darwin') return '/run/host-services/ssh-auth.sock';
    if (process.platform === 'win32') throw new Error('SSH agent forwarding is not available on Windows hosts');
    const socket = process.env.SSH_AUTH_SOCK;
    if (!socket || !isSocket(socket)) throw new Error('SSH agent forwarding needs a running SSH agent (SSH_AUTH_SOCK)');
    return socket;
  }

  private write(instance: { name: string; settings: InstanceSettings; mounts: InstanceMount[] }, markDesktop: boolean): void {
    if (instance.settings.uid === '0' || instance.settings.gid === '0') throw new Error('refusing to run agents as root; start TodeX as your normal user');
    writeInstance(join(this.root, instance.name), {
      name: instance.name,
      settings: instance.settings,
      mounts: instance.mounts,
      ipcDir: this.prepareIpcDir(instance.name),
      sshAgentSocket: this.sshAgentSocket(instance.settings),
    }, markDesktop);
  }

  private async waitHealthy(name: string): Promise<void> {
    this.progress({ name, phase: 'wait' });
    const container = containerName(name);
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    let state = '';
    while (Date.now() < deadline) {
      state = (await runDocker(['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', container], { timeoutMs: 10_000 }).catch(() => '')).trim();
      if (state === 'healthy') return;
      if (state === 'exited' || state === 'dead') break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const lines: string[] = [];
    await runDocker(['logs', '--tail', '30', container], { timeoutMs: 10_000, onLine: (line) => lines.push(line) }).catch(() => undefined);
    throw new Error(`the container did not become healthy (state: ${state || 'unknown'})${lines.length ? `\n${lines.join('\n')}` : ''}`);
  }

  private async up(name: string): Promise<void> {
    this.progress({ name, phase: 'start' });
    await this.compose(name, ['up', '-d', '--remove-orphans'], 'pull', UP_TIMEOUT_MS);
    await this.waitHealthy(name);
  }

  private async realDirectory(path: unknown): Promise<string> {
    if (typeof path !== 'string' || !isAbsolute(path) || /[\t\n]/.test(path)) throw new TypeError('path');
    const real = realpathSync.native(path);
    if (!statSync(real).isDirectory()) throw new Error(`not a directory: ${path}`);
    return real;
  }

  private async freePort(): Promise<number> {
    const taken = new Set((await this.list()).map((item) => item.port).filter((port): port is number => port !== null));
    for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 100; port += 1) {
      if (!taken.has(port) && await portFree(port)) return port;
    }
    throw new Error('no free port between 7345 and 7444');
  }

  private freeName(): string {
    const existing = new Set(this.instances().map((item) => item.name));
    if (!existing.has('todex')) return 'todex';
    for (let index = 2; ; index += 1) if (!existing.has(`todex-${index}`)) return `todex-${index}`;
  }

  /** Creates an instance mounting `mounts` and starts it. Agents are installed later, over the API. */
  async create(options: { name?: unknown; mounts: unknown; sshAgent?: unknown; tag?: unknown }): Promise<ContainerInfo> {
    await this.requireDocker();
    const name = options.name === undefined || options.name === '' ? this.freeName() : options.name;
    if (!isInstanceName(name)) throw new TypeError('name');
    if (readInstance(this.root, name, this.defaults())) throw new Error(`a container named ${name} already exists`);
    if (!Array.isArray(options.mounts) || !options.mounts.length) throw new TypeError('mounts');
    const tag = typeof options.tag === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(options.tag) ? options.tag : 'latest';
    return this.exclusive(name, async () => {
      const mounts: InstanceMount[] = [];
      for (const raw of options.mounts as unknown[]) {
        const host = await this.realDirectory(raw);
        if (mountCovering(mounts, host, process.platform === 'win32')) continue;
        mounts.push({ host, target: mountTargetFor(host, process.platform, mounts) });
      }
      const settings: InstanceSettings = { ...this.defaults(), port: await this.freePort(), tag, extraAgents: '', sshAgent: options.sshAgent === true };
      this.write({ name, settings, mounts }, true);
      this.host.log('info', 'container.create', { name, port: settings.port, mounts: mounts.length });
      await this.up(name);
      return (await this.list()).find((item) => item.name === name)!;
    });
  }

  async start(name: string): Promise<void> {
    await this.requireDocker();
    const info = (await this.list()).find((item) => item.name === name);
    if (!info) throw new Error(`${name} does not exist`);
    if (!info.managed) {
      await runDocker(['start', info.container!], { timeoutMs: 60_000 });
      return;
    }
    await this.exclusive(name, async () => {
      // Regenerated like todexc's `upgrade`, so a removed container comes back from its settings.
      const instance = this.instance(name);
      this.write(instance, false);
      await this.up(name);
    });
  }

  async stop(name: string): Promise<void> {
    const info = (await this.list()).find((item) => item.name === name);
    if (!info?.container) return;
    this.progress({ name, phase: 'stop' });
    if (!info.managed) {
      await runDocker(['stop', info.container], { timeoutMs: 60_000 });
      return;
    }
    await this.exclusive(name, () => this.compose(name, ['stop'], 'stop'));
  }

  async restart(name: string): Promise<void> {
    const info = (await this.list()).find((item) => item.name === name);
    if (!info?.container) throw new Error(`${name} has no container`);
    if (!info.managed) {
      await runDocker(['restart', info.container], { timeoutMs: 90_000 });
      return;
    }
    await this.exclusive(name, async () => {
      await this.compose(name, ['restart'], 'start');
      await this.waitHealthy(name);
    });
  }

  /** Pulls the image and recreates the container (todexc `upgrade`). */
  async upgrade(name: string): Promise<void> {
    await this.requireDocker();
    await this.exclusive(name, async () => {
      const instance = this.instance(name);
      this.write(instance, false);
      this.progress({ name, phase: 'pull' });
      await this.compose(name, ['pull', 'todex'], 'pull', UP_TIMEOUT_MS);
      await this.up(name);
    });
    if (this.host.prefs().cleanupImages !== false) await this.cleanupImages();
  }

  /** Removes the container and its instance directory; the home volume only when asked. */
  async remove(name: string, deleteVolume: boolean): Promise<void> {
    await this.requireDocker();
    await this.exclusive(name, async () => {
      const instance = this.instance(name);
      this.progress({ name, phase: 'remove' });
      await this.compose(name, ['down', ...(deleteVolume ? ['-v'] : [])], 'remove');
      rmSync(instance.dir, { recursive: true, force: true });
      this.host.log('info', 'container.remove', { name, deleteVolume });
    });
  }

  /**
   * Makes `hostPath` visible in the container: nothing to do when a mount
   * already covers it, else the folder is mounted and the container recreated.
   * Resolves the folder's path inside the container.
   */
  async addMount(name: string, hostPath: unknown): Promise<MountResult> {
    await this.requireDocker();
    const host = await this.realDirectory(hostPath);
    const windows = process.platform === 'win32';
    return this.exclusive(name, async () => {
      const instance = this.instance(name);
      const covering = mountCovering(instance.mounts, host, windows);
      const running = (await this.list()).find((item) => item.name === name)?.state === 'running';
      if (covering) {
        if (!running) {
          this.write(instance, false);
          await this.up(name);
        }
        return { target: covering.target, backendPath: backendPathFor(covering, host, windows), recreated: false };
      }
      const mount = { host, target: mountTargetFor(host, process.platform, instance.mounts) };
      this.write({ ...instance, mounts: [...instance.mounts, mount] }, false);
      this.host.log('info', 'container.mount.add', { name });
      await this.up(name);
      return { target: mount.target, backendPath: mount.target, recreated: running };
    });
  }

  /** Unmounts the host folders not in `keepHosts` (never the last one) and recreates the container when anything changed. */
  async setMounts(name: string, keepHosts: unknown): Promise<string[]> {
    if (!Array.isArray(keepHosts) || keepHosts.some((item) => typeof item !== 'string')) throw new TypeError('keepHosts');
    await this.requireDocker();
    return this.exclusive(name, async () => {
      const instance = this.instance(name);
      const keep = instance.mounts.filter((mount) => (keepHosts as string[]).includes(mount.host));
      if (!keep.length || keep.length === instance.mounts.length) return [];
      const removed = instance.mounts.filter((mount) => !keep.includes(mount)).map((mount) => mount.host);
      this.write({ ...instance, mounts: keep }, false);
      this.host.log('info', 'container.mount.remove', { name, count: removed.length });
      if ((await this.list()).find((item) => item.name === name)?.state === 'running') await this.up(name);
      return removed;
    });
  }

  // ---- cleanup ------------------------------------------------------------

  /** Deletes TodeX image versions no container uses and no instance asks for. */
  private async cleanupImages(): Promise<number> {
    const [images, used] = await Promise.all([todexImages(), imagesInUse()]);
    const wanted = new Set(this.instances().filter((item) => item.settings.image === DEFAULT_IMAGE).map((item) => item.settings.tag));
    let removed = 0;
    for (const image of images) {
      if (used.has(image.id) || wanted.has(image.tag)) continue;
      try {
        await runDocker(['image', 'rm', image.tag && image.tag !== '<none>' ? `${DEFAULT_IMAGE}:${image.tag}` : image.id], { timeoutMs: 60_000 });
        removed += 1;
      } catch (error) {
        this.host.log('warn', 'container.cleanup.imageFailed', { image: image.id, error: errorMessage(error) });
      }
    }
    return removed;
  }

  /** Removes containers stopped longer than `days` (home volumes and instance settings stay). */
  private async cleanupStopped(days: number): Promise<number> {
    const cutoff = Date.now() - days * DAY_MS;
    let removed = 0;
    for (const item of await this.list()) {
      if (!item.container || !['exited', 'created', 'dead'].includes(item.state)) continue;
      const since = Date.parse(item.finishedAt ?? item.startedAt ?? '');
      if (!Number.isFinite(since) || since > cutoff) continue;
      try {
        if (item.managed) await this.exclusive(item.name, () => this.compose(item.name, ['down'], 'remove'));
        else await runDocker(['rm', item.container], { timeoutMs: 60_000 });
        removed += 1;
      } catch (error) {
        this.host.log('warn', 'container.cleanup.removeFailed', { name: item.name, error: errorMessage(error) });
      }
    }
    return removed;
  }

  async cleanup(): Promise<{ images: number; containers: number }> {
    const env = await this.environment(true);
    if (env.problem || !env.composeVersion) return { images: 0, containers: 0 };
    const prefs = this.host.prefs();
    const days = Number(prefs.removeStoppedDays);
    const containers = Number.isFinite(days) && days > 0 ? await this.cleanupStopped(days) : 0;
    const images = prefs.cleanupImages !== false ? await this.cleanupImages() : 0;
    if (images || containers) this.host.log('info', 'container.cleanup', { images, containers });
    return { images, containers };
  }

  /** Cleanup a minute after start, then every 6 hours. */
  scheduleCleanup(): void {
    const tick = () => void this.cleanup().catch((error) => this.host.log('warn', 'container.cleanup.failed', { error: errorMessage(error) }));
    setTimeout(tick, CLEANUP_FIRST_DELAY_MS).unref();
    this.cleanupTimer = setInterval(tick, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  /** "Stop containers when TodeX quits": the running instances Desktop created. */
  async stopForQuit(): Promise<void> {
    if (this.host.prefs().stopOnQuit !== true) return;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    const env = this.environmentCache ?? await this.environment();
    if (env.problem) return;
    const running = (await this.list()).filter((item) => item.desktop && item.state === 'running');
    await Promise.all(running.map((item) => this.compose(item.name, ['stop'], 'stop', 60_000).catch((error) => {
      this.host.log('warn', 'container.stopOnQuit.failed', { name: item.name, error: errorMessage(error) });
    })));
  }

  register(handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => void): void {
    const name = (value: unknown): string => {
      if (!isInstanceName(value)) throw new TypeError('name');
      return value;
    };
    // Progress goes to the window that started the operation.
    const from = <T>(event: IpcMainInvokeEvent, task: () => Promise<T>) => {
      this.sender = event.sender;
      return task();
    };
    handle('container:environment', (_event, refresh: unknown) => this.environment(refresh === true));
    handle('container:list', () => this.list());
    handle('container:logs', (_event, value) => this.logs(name(value)));
    handle('container:create', (event, options: unknown) => {
      if (!options || typeof options !== 'object') throw new TypeError('options');
      return from(event, () => this.create(options as Parameters<ContainerManager['create']>[0]));
    });
    handle('container:start', (event, value) => from(event, () => this.start(name(value))));
    handle('container:stop', (event, value) => from(event, () => this.stop(name(value))));
    handle('container:restart', (event, value) => from(event, () => this.restart(name(value))));
    handle('container:upgrade', (event, value) => from(event, () => this.upgrade(name(value))));
    handle('container:remove', (event, value, deleteVolume: unknown) => from(event, () => this.remove(name(value), deleteVolume === true)));
    handle('container:addMount', (event, value, hostPath: unknown) => from(event, () => this.addMount(name(value), hostPath)));
    handle('container:setMounts', (event, value, keepHosts: unknown) => from(event, () => this.setMounts(name(value), keepHosts)));
    handle('container:cleanup', () => this.cleanup());
  }
}

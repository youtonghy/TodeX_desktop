import { spawn } from 'node:child_process';
import { DEFAULT_IMAGE, INSTANCE_LABEL } from './instance.ts';

/** Docker CLI calls for TodeX containers, always without a shell. */

export class DockerError extends Error {
  readonly code: DockerProblem | 'failed';
  /** The command's exit status, when it ran and failed. */
  readonly exitCode: number | null;

  constructor(message: string, code: DockerProblem | 'failed' = 'failed', exitCode: number | null = null) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** Why the Docker daemon cannot be used. */
export type DockerProblem = 'missing' | 'permission' | 'daemonDown';

export function classifyDockerError(stderr: string, spawnCode?: string): DockerProblem | 'failed' {
  if (spawnCode === 'ENOENT') return 'missing';
  if (/permission denied/i.test(stderr)) return 'permission';
  if (/cannot connect to the docker daemon|is the docker daemon running|error during connect|docker_engine|dockerDesktopLinuxEngine|connection refused/i.test(stderr)) return 'daemonDown';
  return 'failed';
}

export type RunOptions = {
  timeoutMs?: number;
  /** Each output line (stdout and stderr), e.g. pull progress. */
  onLine?: (line: string) => void;
  signal?: AbortSignal;
};

/** Runs `docker <args>`; resolves stdout, rejects with the last stderr lines. */
export function runDocker(args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: options.signal });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const emit = (chunk: string) => {
      if (!options.onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) options.onLine(line);
    };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (stdout.length < 8 * 1024 * 1024) stdout += chunk;
      emit(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-64 * 1024);
      emit(chunk);
    });
    const timer = options.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : null;
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer);
      const code = classifyDockerError(stderr, error.code);
      reject(new DockerError(code === 'missing' ? 'docker is not installed' : error.message, code));
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const message = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-6).join('\n')
        || (signal ? `docker ${args[0] ?? ''} was stopped (${signal})` : `docker ${args[0] ?? ''} exited with ${code}`);
      reject(new DockerError(message, classifyDockerError(stderr), code));
    });
  });
}

export type DockerEnvironment = {
  /** Client version, null when the CLI is missing. */
  clientVersion: string | null;
  serverVersion: string | null;
  /** Why the daemon cannot be used, null when it can. */
  problem: DockerProblem | null;
  problemDetail: string | null;
  composeVersion: string | null;
  /** e.g. "Docker Desktop", "Arch Linux". */
  operatingSystem: string | null;
  rootless: boolean;
  userns: boolean;
  podman: boolean;
  /** Tags of the TodeX image present locally. */
  imageTags: string[];
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function detectEnvironment(): Promise<DockerEnvironment> {
  const environment: DockerEnvironment = {
    clientVersion: null,
    serverVersion: null,
    problem: null,
    problemDetail: null,
    composeVersion: null,
    operatingSystem: null,
    rootless: false,
    userns: false,
    podman: false,
    imageTags: [],
  };
  try {
    environment.clientVersion = (await runDocker(['version', '--format', '{{.Client.Version}}'], { timeoutMs: 10_000 })).trim() || null;
  } catch (error) {
    // `docker version` prints the client and fails when the daemon is unreachable.
    const code = error instanceof DockerError ? error.code : 'failed';
    if (code === 'missing') {
      environment.problem = 'missing';
      return environment;
    }
  }
  if (!environment.clientVersion) {
    try {
      environment.clientVersion = /version\s+([^\s,]+)/i.exec(await runDocker(['--version'], { timeoutMs: 10_000 }))?.[1] ?? 'unknown';
    } catch (error) {
      environment.problem = error instanceof DockerError && error.code === 'missing' ? 'missing' : null;
      if (environment.problem) return environment;
    }
  }
  try {
    environment.composeVersion = (await runDocker(['compose', 'version', '--short'], { timeoutMs: 10_000 })).trim() || null;
  } catch {
    environment.composeVersion = null;
  }
  try {
    const info = JSON.parse(await runDocker(['info', '--format', '{{json .}}'], { timeoutMs: 15_000 })) as Record<string, unknown>;
    environment.serverVersion = typeof info.ServerVersion === 'string' ? info.ServerVersion : null;
    environment.operatingSystem = typeof info.OperatingSystem === 'string' ? info.OperatingSystem : null;
    const security = Array.isArray(info.SecurityOptions) ? info.SecurityOptions.map(String) : [];
    environment.rootless = security.some((option) => option.includes('rootless'));
    environment.userns = security.some((option) => option.includes('userns'));
    // `podman info` (behind a `docker` shim) answers with its own shape: a `host` object.
    environment.podman = /podman/i.test(environment.operatingSystem ?? '') || (typeof info.host === 'object' && info.host !== null);
    // Server errors (permission, daemon down) still print JSON with ServerErrors.
    const serverErrors = Array.isArray(info.ServerErrors) ? info.ServerErrors.map(String) : [];
    if (serverErrors.length && !environment.serverVersion) {
      environment.problem = classifyDockerError(serverErrors.join('\n')) === 'permission' ? 'permission' : 'daemonDown';
      environment.problemDetail = serverErrors.join('\n');
    }
  } catch (error) {
    const code = error instanceof DockerError ? error.code : 'failed';
    environment.problem = code === 'permission' ? 'permission' : code === 'missing' ? 'missing' : 'daemonDown';
    environment.problemDetail = errorText(error);
  }
  if (!environment.problem) {
    try {
      const out = await runDocker(['image', 'ls', DEFAULT_IMAGE, '--format', '{{.Tag}}'], { timeoutMs: 15_000 });
      environment.imageTags = out.split(/\r?\n/).map((line) => line.trim()).filter((tag) => tag && tag !== '<none>');
    } catch {
      environment.imageTags = [];
    }
  }
  return environment;
}

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting' | null;

/** The parts of `docker inspect` the container page shows. */
export type InspectedContainer = {
  id: string;
  name: string;
  instance: string;
  image: string;
  imageId: string;
  state: string;
  health: ContainerHealth;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
  /** Host ports bound to the container's 7345. */
  ports: Array<{ hostIp: string; hostPort: number }>;
  binds: Array<{ host: string; target: string }>;
  /** Compose's config file, when it started the container. */
  composeFile: string | null;
};

const ZERO_TIME = '0001-01-01T00:00:00Z';

export function parseInspect(raw: unknown): InspectedContainer[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): InspectedContainer[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, any>;
    const labels = (value.Config?.Labels ?? {}) as Record<string, string>;
    const instance = labels[INSTANCE_LABEL];
    if (typeof instance !== 'string') return [];
    const health = value.State?.Health?.Status;
    const time = (input: unknown) => (typeof input === 'string' && input && !input.startsWith(ZERO_TIME.slice(0, 4)) ? input : null);
    const bindings = (value.HostConfig?.PortBindings?.['7345/tcp'] ?? value.NetworkSettings?.Ports?.['7345/tcp'] ?? []) as Array<{ HostIp?: string; HostPort?: string }>;
    const mounts = (Array.isArray(value.Mounts) ? value.Mounts : []) as Array<{ Type?: string; Source?: string; Destination?: string }>;
    return [{
      id: String(value.Id ?? ''),
      name: String(value.Name ?? '').replace(/^\//, ''),
      instance: instance || String(value.Name ?? '').replace(/^\//, ''),
      image: String(value.Config?.Image ?? ''),
      imageId: String(value.Image ?? ''),
      state: String(value.State?.Status ?? 'unknown'),
      health: health === 'healthy' || health === 'unhealthy' || health === 'starting' ? health : null,
      startedAt: time(value.State?.StartedAt),
      finishedAt: time(value.State?.FinishedAt),
      createdAt: time(value.Created),
      ports: (bindings ?? []).map((binding) => ({ hostIp: binding.HostIp || '0.0.0.0', hostPort: Number(binding.HostPort) })).filter((binding) => binding.hostPort > 0),
      binds: mounts.filter((mount) => mount.Type === 'bind' && mount.Source && mount.Destination && mount.Destination !== '/run/todex-ipc' && mount.Destination !== '/run/host-ssh-agent.sock')
        .map((mount) => ({ host: mount.Source!, target: mount.Destination! })),
      composeFile: typeof labels['com.docker.compose.project.config_files'] === 'string' ? labels['com.docker.compose.project.config_files'].split(',')[0] || null : null,
    }];
  });
}

/** Every container (running or not) carrying the TodeX instance label. */
export async function inspectTodexContainers(): Promise<InspectedContainer[]> {
  const ids = (await runDocker(['ps', '-a', '-q', '--no-trunc', '--filter', `label=${INSTANCE_LABEL}`], { timeoutMs: 15_000 }))
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!ids.length) return [];
  return parseInspect(JSON.parse(await runDocker(['inspect', ...ids], { timeoutMs: 15_000 })));
}

export type ImageEntry = { id: string; tag: string };

export async function todexImages(): Promise<ImageEntry[]> {
  const out = await runDocker(['image', 'ls', '--no-trunc', DEFAULT_IMAGE, '--format', '{{.ID}}\t{{.Tag}}'], { timeoutMs: 15_000 });
  return out.split(/\r?\n/).map((line) => line.split('\t')).filter((parts) => parts[0]).map(([id, tag]) => ({ id, tag: tag ?? '' }));
}

/** Image ids any container on this machine uses (TodeX or not). */
export async function imagesInUse(): Promise<Set<string>> {
  const ids = (await runDocker(['ps', '-a', '-q', '--no-trunc'], { timeoutMs: 15_000 })).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!ids.length) return new Set();
  const out = await runDocker(['inspect', '--format', '{{.Image}}', ...ids], { timeoutMs: 15_000 });
  return new Set(out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

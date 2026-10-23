import { execFile } from 'node:child_process';

export type DaemonStatus = {
  running: boolean;
  pid: number | null;
  host: string | null;
  port: number | null;
  startedAt: string | null;
  executable: string | null;
  ipcPath: string | null;
  outdated: boolean;
  apiListen: string | null;
};

export class BackendCliError extends Error {
  constructor(message: string, readonly exitCode: number | null) {
    super(message);
  }
}

/** Runs `todex-agentd <args>` without a shell; resolves stdout, rejects with
 * the command's own stderr (the backend prints user-facing messages there). */
export function runBackend(binary: string, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout);
        return;
      }
      const message = String(stderr).trim().split(/\r?\n/).filter(Boolean).slice(-6).join('\n')
        || (error.killed ? `todex-agentd ${args[0] ?? ''} timed out` : error.message);
      reject(new BackendCliError(message, typeof error.code === 'number' ? error.code : null));
    });
  });
}

/** `daemon start|stop|restart` wait for readiness themselves (up to 120 s). */
const DAEMON_TIMEOUT_MS = 150_000;

export async function daemonStatus(binary: string, dataDir: string): Promise<DaemonStatus> {
  const stdout = await runBackend(binary, ['daemon', 'status', '--format', 'json', '--data-dir', dataDir]);
  const raw = JSON.parse(stdout) as Partial<DaemonStatus>;
  return {
    running: raw.running === true,
    pid: typeof raw.pid === 'number' ? raw.pid : null,
    host: typeof raw.host === 'string' ? raw.host : null,
    port: typeof raw.port === 'number' ? raw.port : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    executable: typeof raw.executable === 'string' ? raw.executable : null,
    ipcPath: typeof raw.ipcPath === 'string' ? raw.ipcPath : null,
    outdated: raw.outdated === true,
    apiListen: typeof raw.apiListen === 'string' ? raw.apiListen : null,
  };
}

export function daemonCommand(binary: string, dataDir: string, action: 'start' | 'stop' | 'restart'): Promise<string> {
  return runBackend(binary, ['daemon', action, '--data-dir', dataDir], DAEMON_TIMEOUT_MS);
}

export async function autostartEnabled(binary: string): Promise<boolean> {
  const stdout = await runBackend(binary, ['daemon', 'autostart', 'status']);
  return /^Autostart enabled:/m.test(stdout);
}

export async function setAutostart(binary: string, dataDir: string, enabled: boolean): Promise<void> {
  await runBackend(binary, enabled ? ['daemon', 'autostart', 'enable', '--data-dir', dataDir] : ['daemon', 'autostart', 'disable']);
}

/** `pair approve`, for a container reached over TCP whose socket is not
 * shared with the host (Docker Desktop): the same command the pairing panel
 * asks the user to paste, run through `docker exec`. */
export function dockerPairApprove(container: string, verificationCode: string): Promise<string> {
  return runBackend('docker', ['exec', '-u', 'todex', container, 'todex-agentd', 'pair', 'approve', verificationCode], 30_000);
}

export type DockerInstance = { container: string; instance: string; ports: string };

/** Running TodeX containers (`io.todex.instance` label); empty when docker is missing. */
export async function dockerInstances(): Promise<DockerInstance[]> {
  let stdout: string;
  try {
    stdout = await runBackend('docker', ['ps', '--filter', 'label=io.todex.instance', '--format', '{{.Names}}\t{{.Label "io.todex.instance"}}\t{{.Ports}}'], 10_000);
  } catch {
    return [];
  }
  return stdout.split(/\r?\n/).map((line) => line.split('\t')).filter((parts) => parts[0]).map(([container, instance, ports]) => ({
    container,
    instance: instance || container,
    ports: ports ?? '',
  }));
}

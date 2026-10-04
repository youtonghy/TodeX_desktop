import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { app } from 'electron';
import { ExecutorFailure, type ExecutorLogger } from './executorLink';

const REQUEST_TIMEOUT_MS = 25_000;

/** The helper binary: Resources/bin when packaged, build/bin in development. */
export function computerHelperPath(): string | null {
  // Development: out/main/index.js → <desktop>/build/bin (however the app was started).
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'bin', 'todex-computer')]
    : [join(__dirname, '..', '..', 'build', 'bin', 'todex-computer'), join(app.getAppPath(), 'build', 'bin', 'todex-computer')];
  return candidates.find(path => existsSync(path)) ?? null;
}

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/**
 * JSON-lines client for `todex-computer`. Started on first use; a crash
 * fails the calls in flight and the next call starts a fresh helper.
 */
export class ComputerHelper {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;

  constructor(private readonly path: string, private readonly log: ExecutorLogger) {}

  request(cmd: string, fields: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
    const child = this.ensure();
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ExecutorFailure('EXECUTOR_FAILED', `the Computer Use helper did not answer ${cmd} in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...fields, id, cmd })}\n`);
    });
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child && this.child.exitCode === null) return this.child;
    const child = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    createInterface({ input: child.stdout }).on('line', line => this.onLine(line));
    createInterface({ input: child.stderr }).on('line', line => this.log('debug', 'computer.helper.stderr', { line }));
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.log('warn', 'computer.helper.exit', { code, signal });
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new ExecutorFailure('EXECUTOR_FAILED', 'the Computer Use helper stopped'));
        this.pending.delete(id);
      }
    });
    child.on('error', error => this.log('error', 'computer.helper.error', { error: String(error) }));
    return child;
  }

  private onLine(line: string): void {
    let frame: { id?: string; ok?: boolean; result?: Record<string, unknown>; error?: { code?: string; message?: string } };
    try {
      frame = JSON.parse(line);
    } catch {
      this.log('warn', 'computer.helper.badLine', { line: line.slice(0, 200) });
      return;
    }
    const pending = frame.id ? this.pending.get(frame.id) : undefined;
    if (!pending || !frame.id) return;
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.ok) pending.resolve(frame.result ?? {});
    else pending.reject(new ExecutorFailure(frame.error?.code ?? 'EXECUTOR_FAILED', frame.error?.message ?? 'the Computer Use helper failed'));
  }
}

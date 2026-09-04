import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const DEBUG_BUILD_VERSION = 'DEV0.0.0';
export const DEBUG_LOG_PATH_KEY = 'todex.desktop.debug.logPath';
export const DEBUG_LOG_FILE_NAME = 'todex-desktop-debug.log';
export const CHROMIUM_LOG_FILE_NAME = 'todex-desktop-chromium.log';
const MAX_LOG_FILE_BYTES = 20 * 1024 * 1024;
const MAX_STRING_LENGTH = 16 * 1024;
const MAX_OBJECT_KEYS = 100;
const SENSITIVE_KEY = /(authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|password|passwd|secret|private[_-]?key|cookie|set-cookie)/i;

export type DebugLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type DebugLogInfo = {
  enabled: boolean;
  buildVersion: string;
  configPath: string;
  logPath: string;
  chromiumLogPath: string;
};

export function isDebugBuild(buildVersion: string): boolean {
  return buildVersion === DEBUG_BUILD_VERSION;
}

export function normalizeConfiguredLogPath(raw: unknown, userDataPath: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return join(userDataPath, 'logs', DEBUG_LOG_FILE_NAME);
  const resolved = isAbsolute(value) ? value : resolve(userDataPath, value);
  return resolved.endsWith('/') || resolved.endsWith('\\')
    ? join(resolved, DEBUG_LOG_FILE_NAME)
    : resolved;
}

export function chromiumLogPath(logPath: string): string {
  return join(dirname(logPath), CHROMIUM_LOG_FILE_NAME);
}

function redactString(value: string): string {
  if (/^data:[^,]+,/i.test(value)) return `[data-url ${value.length} chars]`;
  const shortened = value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated ${value.length - MAX_STRING_LENGTH} chars]`
    : value;
  return shortened.replace(
    /((?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|password|passwd|secret|private[_-]?key|cookie|set-cookie)\s*[=:]\s*)([^,\s;]+)/gi,
    '$1[REDACTED]',
  );
}

export function redactForLog(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (depth >= 6) return '[max-depth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.slice(0, MAX_OBJECT_KEYS).map((item) => redactForLog(item, depth + 1, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactForLog(item, depth + 1, seen);
  }
  return output;
}

function serialize(value: unknown): string {
  try {
    return JSON.stringify(redactForLog(value)) ?? 'null';
  } catch {
    return '[unserializable]';
  }
}

export class DebugLogger {
  readonly info: DebugLogInfo;
  private sequence = 0;

  constructor(info: DebugLogInfo) {
    this.info = info;
  }

  start(): void {
    if (!this.info.enabled) return;
    try {
      mkdirSync(dirname(this.info.logPath), { recursive: true });
      if (existsSync(this.info.logPath) && statSync(this.info.logPath).size > MAX_LOG_FILE_BYTES) {
        renameSync(this.info.logPath, `${this.info.logPath}.previous`);
      }
      this.write('info', 'debug.logger.started', { configPath: this.info.configPath, logPath: this.info.logPath, chromiumLogPath: this.info.chromiumLogPath });
    } catch {
      // Diagnostics must never prevent the application from starting.
    }
  }

  write(level: DebugLogLevel, event: string, data?: unknown): void {
    if (!this.info.enabled) return;
    const record = {
      timestamp: new Date().toISOString(),
      sequence: ++this.sequence,
      pid: process.pid,
      level,
      event,
      ...(data === undefined ? {} : { data: redactForLog(data) }),
    };
    try {
      mkdirSync(dirname(this.info.logPath), { recursive: true });
      appendFileSync(this.info.logPath, `${serialize(record)}\n`, 'utf8');
    } catch {
      // Do not recurse through console logging when the log file is unavailable.
    }
  }
}

export function installConsoleCapture(logger: DebugLogger, source: string): () => void {
  const methods: Array<Exclude<DebugLogLevel, 'fatal'>> = ['trace', 'debug', 'info', 'warn', 'error'];
  const originals = new Map<Exclude<DebugLogLevel, 'fatal'>, (...args: unknown[]) => void>();
  for (const level of methods) {
    const original = console[level] as (...args: unknown[]) => void;
    originals.set(level, original);
    console[level] = (...args: unknown[]) => {
      original(...args);
      logger.write(level, 'console', { source, args });
    };
  }
  return () => {
    for (const [level, original] of originals) console[level] = original;
  };
}

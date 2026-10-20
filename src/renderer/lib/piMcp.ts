import type { PiMcpExposure, PiMcpServerConfig } from '@todex/protocol/v2';

/** Server exposures, Pi's default first. */
export const PI_MCP_EXPOSURES: PiMcpExposure[] = ['codemode', 'deferred', 'direct', 'hidden'];

export type PiMcpTransport = 'stdio' | 'http';

/** The fields of a server entry the form edits; `args` one per line, `env` and `headers` as `KEY=VALUE` lines. */
export type PiMcpForm = {
  name: string;
  transport: PiMcpTransport;
  command: string;
  args: string;
  env: string;
  cwd: string;
  url: string;
  headers: string;
  exposure: PiMcpExposure;
  description: string;
  timeout: string;
};

const FORM_KEYS = ['type', 'command', 'args', 'env', 'cwd', 'url', 'headers', 'exposure', 'description', 'timeout'];
const STDIO_KEYS = ['command', 'args', 'env', 'cwd'];
const HTTP_KEYS = ['url', 'headers', 'oauth', 'auth'];
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

export const PI_MCP_TEMPLATE: PiMcpServerConfig = { command: 'npx', args: ['-y', ''] };

export function piMcpTransport(entry: PiMcpServerConfig): PiMcpTransport {
  return typeof entry.url === 'string' && entry.type !== 'stdio' ? 'http' : 'stdio';
}

const lines = (map: unknown) =>
  map && typeof map === 'object' ? Object.entries(map).map(([key, value]) => `${key}=${String(value)}`).join('\n') : '';

export function piMcpForm(name: string, entry: PiMcpServerConfig): PiMcpForm {
  const exposure = entry.exposure === 'codemode-deferred' ? 'codemode' : entry.exposure;
  return {
    name,
    transport: piMcpTransport(entry),
    command: typeof entry.command === 'string' ? entry.command : '',
    args: Array.isArray(entry.args) ? entry.args.join('\n') : '',
    env: lines(entry.env),
    cwd: typeof entry.cwd === 'string' ? entry.cwd : '',
    url: typeof entry.url === 'string' ? entry.url : '',
    headers: lines(entry.headers),
    exposure: exposure && PI_MCP_EXPOSURES.includes(exposure) ? exposure : 'codemode',
    description: typeof entry.description === 'string' ? entry.description : '',
    timeout: typeof entry.timeout === 'number' ? String(entry.timeout) : '',
  };
}

/** `KEY=VALUE` lines as a map; blank lines are skipped, a line without `=` is an error. */
export function parseKeyValues(text: string): Record<string, string> | null {
  const map: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf('=');
    if (at <= 0) return null;
    map[line.slice(0, at).trim()] = line.slice(at + 1);
  }
  return map;
}

/**
 * The entry the form describes, on top of `base`: keys the form does not
 * edit (`toolExposure`, `oauth`, `enabled`, ...) are kept, and the other
 * transport's keys are dropped.
 */
export function piMcpEntry(form: PiMcpForm, base: PiMcpServerConfig): PiMcpServerConfig {
  const entry: PiMcpServerConfig = { ...base };
  const dropped = form.transport === 'stdio' ? HTTP_KEYS : STDIO_KEYS;
  for (const key of [...FORM_KEYS, ...dropped]) delete entry[key];
  const set = (key: string, value: unknown) => {
    const empty = value === '' || (Array.isArray(value) && value.length === 0) || (value && typeof value === 'object' && Object.keys(value).length === 0);
    if (!empty) entry[key] = value;
  };
  // Keep an explicit `type` only when it still names this transport.
  if (base.type && (base.type === 'stdio') === (form.transport === 'stdio')) set('type', base.type);
  if (form.transport === 'stdio') {
    set('command', form.command.trim());
    set('args', form.args.split('\n').filter((arg) => arg.trim() !== ''));
    set('env', parseKeyValues(form.env) ?? {});
    set('cwd', form.cwd.trim());
  } else {
    set('url', form.url.trim());
    set('headers', parseKeyValues(form.headers) ?? {});
  }
  if (form.exposure !== 'codemode') entry.exposure = form.exposure;
  set('description', form.description.trim());
  if (form.timeout.trim()) entry.timeout = Number(form.timeout);
  return entry;
}

export type PiMcpFormError = 'name' | 'nameTaken' | 'command' | 'url' | 'env' | 'headers' | 'timeout';

/** The first problem with the form, by Pi's rules; `others` are the names of the other servers. */
export function piMcpFormError(form: PiMcpForm, others: string[]): PiMcpFormError | null {
  if (!SERVER_NAME.test(form.name)) return 'name';
  if (others.some((other) => other.replace(/-/g, '_') === form.name.replace(/-/g, '_'))) return 'nameTaken';
  if (form.transport === 'stdio') {
    if (!form.command.trim()) return 'command';
    if (!parseKeyValues(form.env)) return 'env';
  } else {
    if (!/^https?:\/\/[^/\s]/.test(form.url.trim())) return 'url';
    if (!parseKeyValues(form.headers)) return 'headers';
  }
  if (form.timeout.trim() && !(Number(form.timeout) > 0)) return 'timeout';
  return null;
}

/** One line naming where a server runs or connects. */
export function piMcpTarget(entry: PiMcpServerConfig): string {
  if (piMcpTransport(entry) === 'http') return String(entry.url ?? '');
  return [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])].filter(Boolean).join(' ');
}

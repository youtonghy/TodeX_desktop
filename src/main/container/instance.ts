import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { posix, win32, join } from 'node:path';

/**
 * TodeX container instances in the layout `todexc` (TodeX_container
 * bin/todexc) keeps under `${XDG_CONFIG_HOME:-~/.config}/todex-container/<name>/`:
 * `settings.env` (sourced by bash), `mounts` (HOST<TAB>TARGET lines) and the
 * generated `compose.yaml`. Desktop reads and writes the same files so either
 * tool can manage an instance; scripts/fixtures/todexc-dev holds todexc's own
 * output for the comparison test. Change both together.
 */

export const DEFAULT_IMAGE = 'ghcr.io/youtonghy/todex_container';
export const DEFAULT_PORT = 7345;
export const INSTANCE_LABEL = 'io.todex.instance';
/** Written next to todexc's files for instances Desktop created (todexc ignores it). */
export const DESKTOP_MARKER = 'desktop.json';

const INSTANCE_NAME = /^[a-z0-9_-]+$/;
// Mount targets that would shadow the image or the system (todexc's list).
const RESERVED_TARGETS = ['/', '/bin', '/boot', '/dev', '/etc', '/home/todex', '/lib', '/lib64', '/opt', '/opt/node', '/opt/todex', '/proc', '/root', '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var'];
const RESERVED_PREFIXES = ['/home/todex/', '/opt/todex/', '/opt/node/', '/usr/', '/etc/', '/proc/', '/sys/', '/dev/', '/run/'];

export type InstanceSettings = {
  port: number;
  /** Publishes `port` on the host (todexc `--no-publish` turns it off: Desktop then connects over the shared socket only). */
  publish: boolean;
  listen: string;
  image: string;
  tag: string;
  /** Comma-separated provider ids the entrypoint installs on start. */
  extraAgents: string;
  sshAgent: boolean;
  uid: string;
  gid: string;
};

export type InstanceMount = { host: string; target: string };

export type InstanceFiles = { name: string; dir: string; settings: InstanceSettings; mounts: InstanceMount[]; desktop: boolean };

export function isInstanceName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 48 && INSTANCE_NAME.test(name);
}

export function configRoot(env: NodeJS.ProcessEnv, home: string): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return join(xdg && xdg.startsWith('/') ? xdg : join(home, '.config'), 'todex-container');
}

/** The default instance is "todex", the name Desktop's approval hint uses. */
export function containerName(name: string): string {
  return name === 'todex' ? 'todex' : `todex-${name}`;
}

export function homeVolume(name: string): string {
  return `todex-${name}-home`;
}

/** The local-backend IPC instance id of a container's shared socket (see src/main/localBackend). */
export function ipcInstanceId(name: string): string {
  return `container-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 64).replace(/-+$/, '');
}

export function defaultSettings(uid: string, gid: string): InstanceSettings {
  return { port: DEFAULT_PORT, publish: true, listen: '127.0.0.1', image: DEFAULT_IMAGE, tag: 'latest', extraAgents: 'claude-code', sshAgent: false, uid, gid };
}

// ---- settings.env ---------------------------------------------------------

/** One bash word as `printf %q` writes it: plain, '…', $'…' or backslash escapes. */
function unquoteShellWord(word: string): string {
  let out = '';
  let index = 0;
  while (index < word.length) {
    const char = word[index];
    if (char === "'") {
      const end = word.indexOf("'", index + 1);
      if (end < 0) throw new Error('unterminated quote');
      out += word.slice(index + 1, end);
      index = end + 1;
    } else if (char === '$' && word[index + 1] === "'") {
      index += 2;
      while (index < word.length && word[index] !== "'") {
        if (word[index] === '\\' && index + 1 < word.length) {
          const next = word[index + 1];
          const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', e: '\x1b', a: '\x07', b: '\b', f: '\f', v: '\v' };
          out += escapes[next] ?? next;
          index += 2;
        } else {
          out += word[index];
          index += 1;
        }
      }
      index += 1;
    } else if (char === '\\' && index + 1 < word.length) {
      out += word[index + 1];
      index += 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/** Safe for bash to source: plain when unambiguous, else single-quoted. */
function quoteShellWord(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_.,:/@%+=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function parseSettingsEnv(text: string, defaults: InstanceSettings): InstanceSettings {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], unquoteShellWord(match[2]));
  }
  const port = Number(values.get('TODEX_PORT'));
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : defaults.port,
    listen: values.get('TODEX_LISTEN') || defaults.listen,
    publish: values.has('TODEX_PUBLISH') ? values.get('TODEX_PUBLISH') !== '0' : defaults.publish,
    image: values.get('TODEX_IMAGE') || defaults.image,
    tag: values.get('TODEX_TAG') || defaults.tag,
    extraAgents: values.has('TODEX_EXTRA_AGENTS') ? values.get('TODEX_EXTRA_AGENTS')! : defaults.extraAgents,
    sshAgent: values.has('TODEX_SSH_AGENT') ? values.get('TODEX_SSH_AGENT') === '1' : defaults.sshAgent,
    uid: values.get('TODEX_UID') || defaults.uid,
    gid: values.get('TODEX_GID') || defaults.gid,
  };
}

export function formatSettingsEnv(settings: InstanceSettings): string {
  const entries: Array<[string, string]> = [
    ['TODEX_PORT', String(settings.port)],
    ['TODEX_LISTEN', settings.listen],
    ['TODEX_PUBLISH', settings.publish ? '1' : '0'],
    ['TODEX_IMAGE', settings.image],
    ['TODEX_TAG', settings.tag],
    ['TODEX_EXTRA_AGENTS', settings.extraAgents],
    ['TODEX_SSH_AGENT', settings.sshAgent ? '1' : '0'],
    ['TODEX_UID', settings.uid],
    ['TODEX_GID', settings.gid],
  ];
  return entries.map(([key, value]) => `${key}=${quoteShellWord(value)}\n`).join('');
}

// ---- mounts -----------------------------------------------------------------

export function parseMounts(text: string): InstanceMount[] {
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const [host, target] = line.split('\t');
    return { host, target: target || host };
  }).filter((mount) => mount.host);
}

export function formatMounts(mounts: InstanceMount[]): string {
  return mounts.map((mount) => `${mount.host}\t${mount.target}\n`).join('');
}

/** todexc's `clean_target`: an absolute container path that hides nothing the image needs. */
export function cleanTarget(raw: string): string {
  if (!raw.startsWith('/')) throw new Error(`mount target must be an absolute path: ${raw}`);
  let target = raw;
  while (target.length > 1 && target.endsWith('/')) target = target.slice(0, -1);
  if (RESERVED_TARGETS.includes(target)) throw new Error(`mount target ${target} would hide part of the container`);
  if (RESERVED_PREFIXES.some((prefix) => target.startsWith(prefix))) throw new Error(`mount target ${target} is inside a path the container needs`);
  if (/[\t\n]/.test(target)) throw new Error('mount paths must not contain tabs or newlines');
  // Workspace roots are passed ':'-separated.
  if (target.includes(':')) throw new Error(`mount target ${target} contains ':'`);
  return target;
}

function within(path: string, root: string, windows: boolean): boolean {
  const sep = windows ? '\\' : '/';
  const normalize = (value: string) => {
    const unified = windows ? value.replace(/\//g, '\\').toLowerCase() : value;
    return unified.length > 1 && unified.endsWith(sep) ? unified.slice(0, -1) : unified;
  };
  const a = normalize(path);
  const b = normalize(root);
  return a === b || a.startsWith(b.endsWith(sep) ? b : `${b}${sep}`);
}

/** The mount whose host folder contains `hostPath`, if any. */
export function mountCovering(mounts: InstanceMount[], hostPath: string, windows: boolean): InstanceMount | undefined {
  return mounts
    .filter((mount) => within(hostPath, mount.host, windows))
    .sort((left, right) => right.host.length - left.host.length)[0];
}

/** The container path of `hostPath` through `mount` (which must cover it). */
export function backendPathFor(mount: InstanceMount, hostPath: string, windows: boolean): string {
  const rest = hostPath.slice(mount.host.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
  if (!rest) return mount.target;
  const parts = windows ? rest.split(/[\\/]+/) : rest.split('/');
  return posix.join(mount.target, ...parts);
}

/**
 * Where a new host folder is mounted: at its own path on Linux and macOS
 * (agent output, git worktrees and the local picker then agree on both
 * sides), under /workspace/<folder> on Windows, whose paths cannot exist in
 * the container.
 */
export function mountTargetFor(hostPath: string, platform: NodeJS.Platform, existing: InstanceMount[]): string {
  if (platform !== 'win32') {
    const target = cleanTarget(hostPath);
    const clash = existing.find((mount) => mount.target === target && mount.host !== hostPath);
    if (clash) throw new Error(`${target} is already mounted from ${clash.host}`);
    return target;
  }
  const base = win32.basename(hostPath).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'workspace';
  const taken = new Set(existing.map((mount) => mount.target));
  for (let index = 1; ; index += 1) {
    const target = `/workspace/${index === 1 ? base : `${base}-${index}`}`;
    if (!taken.has(target)) return target;
  }
}

// ---- compose.yaml -------------------------------------------------------------

/** A JSON string is also a YAML double-quoted scalar; '$' is doubled so Compose does not interpolate it. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '$$$$')}"`;
}

function jsonString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export type ComposeOptions = {
  name: string;
  settings: InstanceSettings;
  mounts: InstanceMount[];
  /** The host directory shared as /run/todex-ipc (Linux), else null. */
  ipcDir: string | null;
  /** The host SSH agent socket when `settings.sshAgent` is on. */
  sshAgentSocket: string | null;
};

export function generateCompose({ name, settings, mounts, ipcDir, sshAgentSocket }: ComposeOptions): string {
  if (!mounts.length) throw new Error('mount at least one work directory');
  const roots = mounts.map((mount) => mount.target).join(':');
  // Mirrored mounts get identity mappings too: they tell Desktop which host folders the container can see.
  const mappings = `[${mounts.map((mount) => `{"hostPath":${jsonString(mount.host)},"backendPath":${jsonString(mount.target)}}`).join(',')}]`;
  let advertiseHost = settings.listen;
  if (['0.0.0.0', '::', '[::]'].includes(advertiseHost)) advertiseHost = '127.0.0.1';
  if (advertiseHost.includes(':')) advertiseHost = `[${advertiseHost}]`;
  const ssh = settings.sshAgent && sshAgentSocket;
  const lines = [
    `# Generated by todexc for instance "${name}"; edit with todexc, not by hand.`,
    `name: ${quote(`todex-${name}`)}`,
    'services:',
    '  todex:',
    `    image: ${quote(`${settings.image}:${settings.tag}`)}`,
    `    container_name: ${quote(containerName(name))}`,
    '    restart: unless-stopped',
    '    labels:',
    `      ${INSTANCE_LABEL}: ${quote(name)}`,
    ...(settings.publish ? ['    ports:', `      - ${quote(`${settings.listen}:${settings.port}:7345`)}`] : []),
    '    environment:',
    `      TODEX_UID: ${quote(settings.uid)}`,
    `      TODEX_GID: ${quote(settings.gid)}`,
    `      TODEX_AGENTD_WORKSPACE_ROOTS: ${quote(roots)}`,
    `      TODEX_AGENTD_PATH_MAPPINGS: ${quote(mappings)}`,
    ...(settings.publish ? [`      TODEX_AGENTD_ADVERTISE_URL: ${quote(`http://${advertiseHost}:${settings.port}`)}`] : []),
    `      TODEX_EXTRA_AGENTS: ${quote(settings.extraAgents)}`,
    ...(ssh ? ['      SSH_AUTH_SOCK: "/run/host-ssh-agent.sock"'] : []),
    '    volumes:',
    '      - type: volume',
    '        source: home',
    '        target: /home/todex',
    ...mounts.flatMap((mount) => ['      - type: bind', `        source: ${quote(mount.host)}`, `        target: ${quote(mount.target)}`]),
    ...(ssh ? ['      - type: bind', `        source: ${quote(sshAgentSocket)}`, '        target: "/run/host-ssh-agent.sock"'] : []),
    ...(ipcDir ? ['      - type: bind', `        source: ${quote(ipcDir)}`, '        target: "/run/todex-ipc"'] : []),
    'volumes:',
    '  home:',
    `    name: ${quote(homeVolume(name))}`,
  ];
  return `${lines.join('\n')}\n`;
}

// ---- files ----------------------------------------------------------------

function writeAtomic(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

export function readInstance(root: string, name: string, defaults: InstanceSettings): InstanceFiles | null {
  const dir = join(root, name);
  const settingsPath = join(dir, 'settings.env');
  if (!isInstanceName(name) || !existsSync(settingsPath)) return null;
  const mountsPath = join(dir, 'mounts');
  return {
    name,
    dir,
    settings: parseSettingsEnv(readFileSync(settingsPath, 'utf8'), defaults),
    mounts: existsSync(mountsPath) ? parseMounts(readFileSync(mountsPath, 'utf8')) : [],
    desktop: existsSync(join(dir, DESKTOP_MARKER)),
  };
}

/** Writes settings.env, mounts and compose.yaml (todexc's `save_settings`, `write_mounts`, `generate_compose`). */
export function writeInstance(dir: string, options: ComposeOptions, markDesktop: boolean): void {
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, 'settings.env'), formatSettingsEnv(options.settings));
  writeAtomic(join(dir, 'mounts'), formatMounts(options.mounts));
  writeAtomic(join(dir, 'compose.yaml'), generateCompose(options));
  if (markDesktop && !existsSync(join(dir, DESKTOP_MARKER))) writeFileSync(join(dir, DESKTOP_MARKER), `${JSON.stringify({ createdAt: new Date().toISOString() })}\n`);
}

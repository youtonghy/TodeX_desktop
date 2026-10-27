import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  backendPathFor,
  cleanTarget,
  defaultSettings,
  formatMounts,
  formatSettingsEnv,
  generateCompose,
  ipcInstanceId,
  mountCovering,
  mountTargetFor,
  parseMounts,
  parseSettingsEnv,
  readInstance,
  writeInstance,
} from '../src/main/container/instance.ts';
import { classifyDockerError, parseInspect } from '../src/main/container/docker.ts';
import { createServer } from 'node:net';
import { pickPort, portAvailable, portRange } from '../src/main/container/ports.ts';

// Written by `todexc --name dev up --mount "/tmp/todexc-fixture/work/a b"
// --mount /tmp/todexc-fixture/work/c:/workspace/c --port 7400 --agents ""`
// (TodeX_container bin/todexc, fake docker, uid/gid 1000).
const fixture = join(import.meta.dirname, 'fixtures', 'todexc-dev');
const read = (name: string) => readFileSync(join(fixture, name), 'utf8');

test('instance files match what todexc writes', () => {
  const defaults = defaultSettings('1000', '1000');
  const settings = parseSettingsEnv(read('settings.env'), defaults);
  assert.deepEqual(settings, { port: 7400, publish: true, listen: '127.0.0.1', image: 'ghcr.io/youtonghy/todex_container', tag: 'latest', extraAgents: '', sshAgent: false, uid: '1000', gid: '1000' });
  assert.equal(formatSettingsEnv(settings), read('settings.env'));
  const mounts = parseMounts(read('mounts'));
  assert.deepEqual(mounts, [
    { host: '/tmp/todexc-fixture/work/a b', target: '/tmp/todexc-fixture/work/a b' },
    { host: '/tmp/todexc-fixture/work/c', target: '/workspace/c' },
  ]);
  assert.equal(formatMounts(mounts), read('mounts'));
  const compose = generateCompose({ name: 'dev', settings, mounts, ipcDir: '/tmp/todexc-fixture/config/todex-container/dev/ipc', sshAgentSocket: null });
  assert.equal(compose, read('compose.yaml'));
});

// `todexc --name ipconly up --no-publish --mount /tmp/todexc-fixture/work/c --agents ""`.
test('unpublished instances match todexc --no-publish', () => {
  const dir = join(import.meta.dirname, 'fixtures', 'todexc-ipconly');
  const settings = parseSettingsEnv(readFileSync(join(dir, 'settings.env'), 'utf8'), defaultSettings('1000', '1000'));
  assert.equal(settings.publish, false);
  assert.equal(formatSettingsEnv(settings), readFileSync(join(dir, 'settings.env'), 'utf8'));
  const mounts = parseMounts(readFileSync(join(dir, 'mounts'), 'utf8'));
  const compose = generateCompose({ name: 'ipconly', settings, mounts, ipcDir: '/tmp/todexc-fixture/config/todex-container/ipconly/ipc', sshAgentSocket: null });
  assert.equal(compose, readFileSync(join(dir, 'compose.yaml'), 'utf8'));
  // Instances written before TODEX_PUBLISH existed keep publishing.
  assert.equal(parseSettingsEnv('TODEX_PORT=7345\n', defaultSettings('1000', '1000')).publish, true);
});

test('settings.env values round-trip through bash quoting', () => {
  const defaults = defaultSettings('501', '20');
  const settings = { ...defaults, extraAgents: "claude-code, it's", image: 'registry.local:5000/todex' };
  assert.deepEqual(parseSettingsEnv(formatSettingsEnv(settings), defaults), settings);
  // printf %q forms.
  assert.equal(parseSettingsEnv('TODEX_EXTRA_AGENTS=a\\ b\\,c\n', defaults).extraAgents, 'a b,c');
  assert.equal(parseSettingsEnv("TODEX_EXTRA_AGENTS=$'a\\tb'\n", defaults).extraAgents, 'a\tb');
  assert.equal(parseSettingsEnv('', defaults).extraAgents, 'claude-code');
});

test('compose quoting keeps $ out of Compose interpolation', () => {
  const settings = defaultSettings('1000', '1000');
  const compose = generateCompose({ name: 'x', settings, mounts: [{ host: '/home/me/$HOME "q"', target: '/home/me/$HOME "q"' }], ipcDir: null, sshAgentSocket: null });
  assert.match(compose, /source: "\/home\/me\/\$\$HOME \\"q\\""/);
  assert.doesNotMatch(compose, /todex-ipc/);
});

test('mount targets follow todexc rules', () => {
  assert.equal(cleanTarget('/home/me/git/'), '/home/me/git');
  for (const bad of ['/etc', '/home/todex/x', '/run/todex-ipc', 'relative', '/a:b', '/usr/local']) assert.throws(() => cleanTarget(bad), bad);
  assert.equal(mountTargetFor('/home/me/git', 'linux', []), '/home/me/git');
  assert.throws(() => mountTargetFor('/etc', 'darwin', []));
  const existing = [{ host: 'D:\\code', target: '/workspace/code' }];
  assert.equal(mountTargetFor('C:\\Users\\me\\code', 'win32', existing), '/workspace/code-2');
  assert.equal(mountTargetFor('C:\\Users\\me\\My Project', 'win32', []), '/workspace/My-Project');
});

test('covered folders map into the container', () => {
  const mounts = [{ host: '/home/me/git', target: '/home/me/git' }, { host: '/home/me/git/big', target: '/workspace/big' }];
  assert.equal(mountCovering(mounts, '/home/me/git/big/app', false)?.target, '/workspace/big');
  assert.equal(backendPathFor(mountCovering(mounts, '/home/me/git/big/app', false)!, '/home/me/git/big/app', false), '/workspace/big/app');
  assert.equal(mountCovering(mounts, '/home/me/gitx', false), undefined);
  const windows = [{ host: 'C:\\Users\\me\\code', target: '/workspace/code' }];
  const covering = mountCovering(windows, 'c:\\users\\me\\code\\app\\src', true)!;
  assert.equal(backendPathFor(covering, 'c:\\users\\me\\code\\app\\src', true), '/workspace/code/app/src');
});

test('written instances read back, with the Desktop marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'todex-container-test-'));
  try {
    const settings = { ...defaultSettings('1000', '1000'), port: 7346 };
    writeInstance(join(root, 'todex'), { name: 'todex', settings, mounts: [{ host: '/srv/x', target: '/srv/x' }], ipcDir: null, sshAgentSocket: null }, true);
    const instance = readInstance(root, 'todex', defaultSettings('1000', '1000'));
    assert.equal(instance?.desktop, true);
    assert.equal(instance?.settings.port, 7346);
    assert.equal(readInstance(root, 'missing', settings), null);
    assert.equal(readInstance(root, '../etc', settings), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('IPC instance ids match the local backend scan', () => {
  assert.equal(ipcInstanceId('todex'), 'container-todex');
  assert.equal(ipcInstanceId('dev_box'), 'container-dev-box');
});

test('docker errors and inspect output are classified', () => {
  assert.equal(classifyDockerError('permission denied while trying to connect to the docker API at unix:///var/run/docker.sock'), 'permission');
  assert.equal(classifyDockerError('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'), 'daemonDown');
  assert.equal(classifyDockerError('', 'ENOENT'), 'missing');
  const [container] = parseInspect([{
    Id: 'abc', Name: '/todex', Image: 'sha256:1', Created: '2026-10-01T00:00:00Z',
    Config: { Image: 'ghcr.io/youtonghy/todex_container:latest', Labels: { 'io.todex.instance': 'todex', 'com.docker.compose.project.config_files': '/home/me/.config/todex-container/todex/compose.yaml' } },
    State: { Status: 'exited', StartedAt: '2026-10-01T00:00:01Z', FinishedAt: '2026-10-02T00:00:00Z', Health: { Status: 'unhealthy' } },
    HostConfig: { PortBindings: { '7345/tcp': [{ HostIp: '127.0.0.1', HostPort: '7345' }] } },
    Mounts: [{ Type: 'volume', Source: 'x', Destination: '/home/todex' }, { Type: 'bind', Source: '/home/me/git', Destination: '/home/me/git' }, { Type: 'bind', Source: '/h/ipc', Destination: '/run/todex-ipc' }],
  }, { Id: 'other', Config: { Labels: {} } }]);
  assert.equal(container.instance, 'todex');
  assert.equal(container.health, 'unhealthy');
  assert.deepEqual(container.ports, [{ hostIp: '127.0.0.1', hostPort: 7345 }]);
  assert.deepEqual(container.binds, [{ host: '/home/me/git', target: '/home/me/git' }]);
  assert.equal(container.composeFile, '/home/me/.config/todex-container/todex/compose.yaml');
  assert.equal(parseInspect([{ Id: 'x', Config: { Labels: {} } }]).length, 0);
});

test('port range falls back to the default for unusable settings', () => {
  assert.deepEqual(portRange({}), { start: 17345, count: 100 });
  assert.deepEqual(portRange({ portStart: 20000, portCount: 10 }), { start: 20000, count: 10 });
  assert.deepEqual(portRange({ portStart: 80, portCount: 0 }), { start: 17345, count: 100 });
  assert.deepEqual(portRange({ portStart: 65530, portCount: 100 }), { start: 65530, count: 6 });
});

test('picked ports skip reserved and busy ones, in random order', async () => {
  const range = { start: 7345, count: 4 };
  const busy = new Set([7347]);
  const available = async (port: number) => !busy.has(port);
  assert.equal(await pickPort(range, new Set([7345, 7346]), available, () => 0), 7348);
  const seen = new Set<number>();
  for (const value of [0, 0.4, 0.99]) seen.add(await pickPort(range, new Set([7345]), available, () => value));
  assert.ok([...seen].every((port) => port === 7346 || port === 7348));
  await assert.rejects(pickPort(range, new Set([7345, 7346, 7348]), available), /no free port between 7345 and 7348/);
});

test('a port held on the wildcard address is not available', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const { port } = server.address() as { port: number };
  try {
    assert.equal(await portAvailable(port), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await portAvailable(port), true);
});

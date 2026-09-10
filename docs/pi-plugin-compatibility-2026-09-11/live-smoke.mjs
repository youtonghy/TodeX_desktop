// Usage: node live-smoke.mjs /absolute/path/to/pi [--backend /absolute/path/to/todex-agentd] [--packages /absolute/path/to/npm/node_modules]
// Uses a new local profile/workspace, an environment allowlist, and registered commands only.
// No real profile, credentials, or model calls are used. --packages adds four reviewed local packages.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';

const [piArgument, ...args] = process.argv.slice(2);
assert(piArgument, 'Provide an absolute Pi executable path.');
const piBin = resolve(piArgument);
const backendIndex = args.indexOf('--backend');
const backendBin = backendIndex < 0 ? null : resolve(args[backendIndex + 1]);
const packagesIndex = args.indexOf('--packages');
const packageRoot = packagesIndex < 0 ? null : resolve(args[packagesIndex + 1]);
assert(!packageRoot || backendBin, '--packages requires --backend');
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'live-fixture.ts');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'todex-pi-live-'));
const workspace = join(temporaryRoot, 'workspace');
const profile = join(temporaryRoot, 'pi-profile');
await mkdir(workspace);
await mkdir(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({ packages: [], defaultProjectTrust: 'no' }));
const env = Object.fromEntries(['PATH', 'TMPDIR', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
env.PI_CODING_AGENT_DIR = profile;
const extensionArgs = ['--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-tools', '-e', fixture];
const pause = ms => new Promise(done => setTimeout(done, ms));
async function eventually(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await pause(30);
  }
  throw new Error(`Timed out: ${label}`);
}
async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
  await new Promise(done => child.once('close', done));
  clearTimeout(timer);
}
function uiAnswer(request) {
  if (request.title === 'Smoke stop pending') return null;
  if (request.title === 'Smoke cancel') return { cancelled: true };
  if (request.method === 'confirm') return { confirmed: true };
  return { value: request.method === 'select' ? 'B' : request.method === 'editor' ? 'edited\ntext' : 'typed text' };
}
const result = { createdAt: new Date().toISOString(), scope: backendBin ? 'real Pi RPC plus Todex HTTP event journal' : 'real Pi RPC only', raw: {}, backend: null };

async function rawSmoke() {
  const child = spawn(piBin, ['--mode', 'rpc', '--no-session', ...extensionArgs], { cwd: workspace, env });
  const frames = [];
  result.raw = { frames };
  const pending = new Map();
  let stderr = '';
  let sequence = 0;
  const lines = createInterface({ input: child.stdout });
  const send = frame => child.stdin.write(JSON.stringify(frame) + '\n');
  child.stderr.on('data', data => { stderr += data.toString(); });
  child.on('error', error => { for (const item of pending.values()) item.reject(error); });
  lines.on('line', line => {
    const frame = JSON.parse(line);
    frames.push(frame);
    if (frame.type === 'response') pending.get(frame.id)?.resolve(frame);
    if (frame.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(frame.method)) {
      const answer = uiAnswer(frame);
      if (answer) send({ type: 'extension_ui_response', id: frame.id, ...answer });
    }
  });
  async function request(type, body = {}) {
    const id = `smoke-${++sequence}`;
    let timer;
    try {
      const response = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timer = setTimeout(() => reject(new Error(`${type} timed out`)), 10000);
        send({ id, type, ...body });
      });
      assert.equal(response.success, true, `${type}: ${response.error}`);
      return response;
    } finally { clearTimeout(timer); pending.delete(id); }
  }
  try {
    const commands = (await request('get_commands')).data.commands;
    for (const name of ['todex-smoke', 'todex-background', 'todex-clear', 'todex-stop-pending']) assert(commands.some(command => command.name === name));
    await request('prompt', { message: '/todex-smoke' });
    const summaryFrame = frames.find(frame => frame.method === 'notify' && frame.message.includes('smoke-results'));
    const summary = JSON.parse(summaryFrame.message);
    assert.deepEqual(summary, { marker: 'smoke-results', mode: 'rpc', hasUI: true, selected: 'B', confirmed: true,
      input: 'typed text', editor: 'edited\ntext', cancelled: true, customCalled: false, customUndefined: true });
    for (const method of ['setStatus', 'setWidget', 'setTitle', 'set_editor_text']) assert(frames.some(frame => frame.method === method), method);
    assert(frames.some(frame => frame.method === 'setWidget' && frame.widgetPlacement === 'belowEditor'));
    for (const display of [true, false]) assert(frames.some(frame => frame.type === 'message_end' && frame.message?.role === 'custom' && frame.message.display === display));
    const backgroundAck = await request('prompt', { message: '/todex-background' });
    assert.equal((await request('get_state')).data.isStreaming, false);
    await eventually(() => frames.find(frame => frame.method === 'notify' && frame.message.includes('smoke-idle-answer')), 'idle dialog answer');
    const idleIndex = frames.findIndex(frame => frame.method === 'notify' && frame.message === 'Idle notification');
    assert(idleIndex > frames.indexOf(backgroundAck), 'Idle events must arrive after command ACK');
    assert.deepEqual(JSON.parse(frames.find(frame => frame.method === 'notify' && frame.message.includes('smoke-idle-answer')).message),
      { marker: 'smoke-idle-answer', selected: 'B', idle: true });
    const clearOffset = frames.length;
    await request('prompt', { message: '/todex-clear' });
    const cleared = frames.slice(clearOffset).filter(frame => ['setStatus', 'setWidget'].includes(frame.method));
    assert.equal(cleared.length, 3);
    assert(cleared.every(frame => !Object.hasOwn(frame, frame.method === 'setStatus' ? 'statusText' : 'widgetLines')));
    await request('abort');
    assert.equal((await request('get_state')).data.isStreaming, false);
    await request('prompt', { message: '/todex-stop-pending' });
    await eventually(() => frames.some(frame => frame.title === 'Smoke stop pending'), 'idle dialog pending at shutdown');
    assert(!frames.some(frame => frame.type === 'agent_start'), 'No model run may start');
    assert(!frames.some(frame => frame.type === 'extension_error'), 'Fixture must have no extension errors');
    result.raw = { passed: true, summary, dialogCount: frames.filter(frame => ['select', 'confirm', 'input', 'editor'].includes(frame.method)).length,
      idleAfterAck: true, abortAcknowledgedAndIdle: true, pendingDialogAtStop: true, noModelRun: true, frames: frames.filter(frame => frame.type !== 'response') };
  } finally {
    await terminate(child);
    result.raw.processStopped = child.exitCode !== null || child.signalCode !== null;
    result.raw.stderr = stderr;
    lines.close();
  }
}

async function backendSmoke() {
  const installed = [];
  const backendExtensionArgs = [...extensionArgs];
  if (packageRoot) {
    await writeFile(join(profile, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
    for (const [name, version] of [['@tintinweb/pi-tasks', '0.9.0'], ['pi-context-prune', '1.4.0'], ['pi-cache-graph', '1.0.2'], ['pi-mcp-adapter', '2.32.1']]) {
      const root = join(packageRoot, name);
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      assert.equal(manifest.version, version, `Re-review ${name}'s safe command branches before testing a different version`);
      installed.push({ name, version });
      for (const entry of manifest.pi.extensions) backendExtensionArgs.push('-e', join(root, entry));
    }
  }
  // An exec wrapper preserves the actual Pi PID and supplies only our explicit fixture.
  const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
  const wrapper = join(temporaryRoot, 'isolated-pi');
  // Todex deliberately filters inherited provider variables, so keep fixture overrides in this executable.
  await writeFile(wrapper, `#!/bin/sh\nexec env PI_TASKS=${quote(join(workspace, 'tasks.json'))} PI_MCP_CONFIG_MODE=exclusive PI_MCP_ADAPTER_TEST_AUTH_STORE=memory PI_MCP_ADAPTER_DISABLE_AUTH_CACHE=1 ${quote(piBin)} "$@" ${backendExtensionArgs.map(quote).join(' ')}\n`);
  await chmod(wrapper, 0o700);
  const probe = createServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const token = 'local-smoke-disposable-token';
  const daemon = spawn(backendBin, ['serve', '--host', '127.0.0.1', '--port', String(port), '--data-dir', join(temporaryRoot, 'backend'), '--workspace-root', workspace], {
    cwd: workspace,
    env: { ...env, PI_TASKS: join(workspace, 'tasks.json'), PI_MCP_ADAPTER_TEST_AUTH_STORE: 'memory', PI_MCP_ADAPTER_DISABLE_AUTH_CACHE: '1',
      TODEX_AUTO_UPDATE: '0', TODEX_AGENTD_PI_BIN: wrapper, TODEX_AGENTD_AUTH_TOKEN: token, TODEX_AGENTD_PAIRING_ENCRYPTION: 'none' },
  });
  let daemonOutput = '';
  daemon.stdout.on('data', data => { daemonOutput += data.toString(); });
  daemon.stderr.on('data', data => { daemonOutput += data.toString(); });
  const base = `http://127.0.0.1:${port}`;
  const events = [];
  async function api(path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    assert(response.ok, `${method} ${path}: ${response.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }
  try {
    await eventually(async () => { try { return await api('/v2/version'); } catch { return false; } }, 'daemon startup');
    const catalog = await api('/v2/workspaces', 'PUT', { workspaces: [{ id: 'smoke-workspace', name: 'Smoke workspace', path: workspace,
      sessionId: '', tenantId: 'local', model: '', approvalPolicy: 'never', sandboxMode: 'workspace-write', createdAt: Date.now(), updatedAt: Date.now() }] });
    const conversation = await api('/v2/conversations', 'POST', { provider: 'pi', workspace, title: 'Pi isolated smoke' });
    const conversationId = conversation.id;
    const path = `/v2/conversations/${conversationId}`;
    const commands = await api(`/v2/providers/commands?provider=pi&workspace=${encodeURIComponent(workspace)}`);
    assert(JSON.stringify(commands).includes('todex-smoke'), 'Fixture command must be discoverable before dispatch');
    const replied = new Set();
    let plannedReplies = [];
    let commandSequence = 0;
    async function poll() {
      const replay = await api(`${path}/events?afterSequence=${events.at(-1)?.sequence ?? 0}&limit=200`);
      for (const event of replay.events) {
        events.push(event);
        if (event.type === 'permission.requested' && !replied.has(event.payload.permissionId)) {
          const request = event.payload;
          let answer;
          if (plannedReplies.length) {
            const planned = plannedReplies.shift();
            if (planned === null) answer = { cancelled: true };
            else if (request.details.method === 'select') {
              const value = request.details.options.find(value => typeof planned === 'string'
                ? value === planned || value.startsWith(planned + ' ') : value.includes(planned.includes));
              assert(value !== undefined, `No matching option for ${JSON.stringify(planned)}`);
              answer = { value };
            } else answer = { value: planned };
          } else answer = uiAnswer(request.details);
          if (!answer) continue;
          replied.add(request.permissionId);
          await api(`${path}/permissions/${request.permissionId}`, 'POST', answer.cancelled
            ? { outcome: 'reject_once' } : { outcome: 'answer', optionId: 'answer', data: answer });
        }
      }
      return events;
    }
    async function command(text, replies = []) {
      const name = text.slice(1).split(' ')[0];
      assert(JSON.stringify(commands).includes(`"${name}"`), 'Only discovered extension commands may be sent');
      plannedReplies = [...replies];
      const response = await api(`${path}/prompt`, 'POST', { text, clientRequestId: `live-command-${++commandSequence}` });
      await eventually(async () => {
        const terminal = (await poll()).find(event => ['turn.completed', 'turn.failed', 'turn.cancelled'].includes(event.type) && event.payload.turnId === response.turnId);
        if (terminal) assert.equal(terminal.type, 'turn.completed', `${text}: ${JSON.stringify(terminal.payload)}`);
        return terminal;
      }, text);
      assert.equal(plannedReplies.length, 0, `${text} did not consume the planned dialog responses`);
      return response;
    }
    await command('/todex-smoke');
    const summary = events.find(event => event.type === 'extension.ui' && event.payload.message?.includes('smoke-results'));
    assert(summary, 'UI summary must reach Todex journal');
    assert.deepEqual(JSON.parse(summary.payload.message), result.raw.summary);
    const sessionCommands = await api(`/v2/providers/commands?conversationId=${encodeURIComponent(conversationId)}`);
    assert.equal(sessionCommands.catalogSource, 'session');
    assert.equal(sessionCommands.runtimeId, summary.payload.runtimeId);
    const packageCatalog = [];
    if (packageRoot) {
      for (const [name, packageName, packageVersion] of [['cache', 'pi-cache-graph', '1.0.2'], ['mcp', 'pi-mcp-adapter', '2.32.1'],
        ['tasks', '@tintinweb/pi-tasks', '0.9.0'], ['pruner', 'pi-context-prune', '1.4.0']]) {
        const descriptor = sessionCommands.commands.find(command => command.name === name);
        assert(descriptor, `${name} command missing from resident session`);
        assert.equal(descriptor.packageName, packageName, `${name} package identity must match the actual manifest`);
        assert.equal(descriptor.packageVersion, packageVersion, `${name} version must match the actual manifest`);
        packageCatalog.push({ name, packageName: descriptor.packageName, packageVersion: descriptor.packageVersion,
          sourceInfo: descriptor.sourceInfo });
      }
    }
    await command('/todex-background');
    await eventually(async () => (await poll()).some(event => event.type === 'extension.ui' && event.payload.message?.includes('smoke-idle-answer')), 'Todex idle answer');
    const idle = events.find(event => event.type === 'extension.ui' && event.payload.message === 'Idle notification');
    assert.equal(idle.payload.scope, 'session');
    assert(!idle.payload.turnId, 'Idle events must not inherit the last turn');
    assert(idle.payload.runtimeId, 'Runtime identity must be available');
    const packageChecks = [];
    if (packageRoot) {
      await command('/tasks', ['Create task', 'Todex backend smoke', 'Disposable local task created through Todex HTTP', null]);
      const tasks = JSON.parse(await readFile(join(workspace, 'tasks.json'), 'utf8'));
      assert.equal(tasks.tasks.length, 1);
      assert.equal(tasks.tasks[0].subject, 'Todex backend smoke');
      const viewOffset = events.length;
      await command('/tasks', ['View all tasks', { includes: 'Todex backend smoke' }, null, null, null]);
      assert(events.slice(viewOffset).some(event => event.type === 'permission.requested' && event.payload.title?.includes('Disposable local task created through Todex HTTP')));
      packageChecks.push({ command: '/tasks create and view', passed: true, tasksPersisted: 1 });
      for (const [text, replies] of [['/pruner stats', []], ['/pruner', ['stats']], ['/mcp', []], ['/mcp tools', []]]) {
        const offset = events.length;
        await command(text, replies);
        const notifications = events.slice(offset).filter(event => event.type === 'extension.ui' && event.payload.method === 'notify');
        assert(notifications.length, `${text} must produce visible feedback`);
        packageChecks.push({ command: text, passed: true, notifications: notifications.map(event => event.payload.message) });
      }
      const offset = events.length;
      await command('/cache export');
      const csv = (await readdir(workspace)).find(name => name.endsWith('.csv'));
      assert(csv, 'Cache export must write a CSV in the isolated workspace');
      const contents = await readFile(join(workspace, csv), 'utf8');
      assert(contents.startsWith('row_type,scope,assistant_messages,'));
      assert(events.slice(offset).some(event => event.type === 'extension.ui' && event.payload.method === 'notify' && event.payload.message.includes('.csv')));
      packageChecks.push({ command: '/cache export', passed: true, csvLines: contents.trim().split('\n').length });
    }
    await command('/todex-clear');
    await command('/todex-stop-pending');
    const pending = await eventually(async () => (await poll()).find(event => event.type === 'permission.requested' && event.payload.title === 'Smoke stop pending'), 'pending idle input before stop');
    const stop = await api(`${path}/runtime/stop`, 'POST', {});
    await eventually(async () => (await poll()).some(event => event.type === 'provider.runtime' && event.payload.status === 'stopped'), 'Todex runtime stopped');
    assert(events.some(event => event.type === 'permission.resolved' && event.payload.permissionId === pending.payload.permissionId), 'Stop must settle pending input');
    const preserved = await api(`${path}/events?afterSequence=0&limit=200`);
    assert(preserved.events.some(event => event.type === 'extension.message' && event.payload.message?.content === 'Visible custom message' && event.payload.message.display === true));
    assert(events.some(event => event.type === 'extension.message' && event.payload.message?.content === 'Hidden custom message' && event.payload.message.display === false));
    result.backend = { passed: true, conversationRetainedAfterStop: true, idleScope: idle.payload.scope,
      dialogResponses: replied.size, pendingInputSettledOnStop: true, sessionCommandCatalog: true, workspaceCount: catalog.workspaces?.length, installed, packageCatalog, packageChecks, stop,
      events: events.map(({ sequence, type, payload }) => ({ sequence, type, payload })) };
  } catch (error) {
    result.backend = { passed: false, error: error.message, daemonOutput, events };
    throw error;
  } finally { await terminate(daemon); }
}

try {
  await rawSmoke();
  console.log('Real Pi RPC smoke passed: dialogs, keyed UI, drafts, custom messages, idle UI, cancellation, abort and stop.');
  if (backendBin) {
    await backendSmoke();
    console.log('Todex backend smoke passed: interactive answers, idle journal events and explicit runtime stop.');
  }
} finally {
  const evidence = join(temporaryRoot, 'live-evidence.json');
  await writeFile(evidence, JSON.stringify(result, null, 2));
  console.log(`Evidence: ${evidence}`);
}

// Runs real installed extension commands with Pi RPC in disposable configuration.
// Usage: node probe.mjs /absolute/path/to/pi /absolute/path/to/npm/node_modules
// No model prompts, API keys, existing sessions, or package installation are used.
// The config override is not a sandbox: some installed plugins still read homedir().
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [piBin, packageRoot] = process.argv.slice(2);
if (!piBin || !packageRoot) throw new Error('Provide Pi executable and installed package directory.');
const root = await mkdtemp(join(tmpdir(), 'todex-pi-compat-'));
const cases = [
  { package: 'pi-cache-graph', commands: ['/cache', '/cache graph', '/cache stats', '/cache export'] },
  { package: '@tmustier/pi-usage-extension', commands: ['/usage'] },
  { package: 'better-custom', commands: ['/better-custom'] },
  { package: 'pi-context-usage', commands: ['/context', '/context details'] },
  { package: 'pi-context-prune', commands: ['/pruner stats', '/pruner settings', '/pruner'], replies: ['stats'] },
  { package: '@tintinweb/pi-tasks', commands: ['/tasks', '/tasks'], replies: ['Create task', 'Todex RPC probe', 'Disposable compatibility task', null, 'Settings'] },
  { package: 'pi-mcp-adapter', commands: ['/mcp', '/mcp tools'], emptyMcp: true },
  { package: 'protocol-fixture', commands: ['/todex-probe'], replies: ['B', true, 'typed', 'edited'], fixture: true },
];

async function run(test, index) {
  const dir = join(root, String(index));
  const config = join(dir, 'agent');
  await mkdir(config, { recursive: true });
  await writeFile(join(config, 'settings.json'), JSON.stringify({ packages: [], defaultProjectTrust: 'no' }));
  const pkg = join(resolve(packageRoot), test.package);
  const manifest = test.fixture ? { version: 'local-fixture', pi: { extensions: [] } } : JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
  let extensionArgs = manifest.pi.extensions.flatMap(p => ['-e', join(pkg, p)]);
  if (test.emptyMcp) {
    const wrapper = join(dir, 'empty-mcp.ts');
    await writeFile(wrapper, `import { createMcpAdapter } from ${JSON.stringify(join(pkg, 'index.ts'))};\nexport default createMcpAdapter({ config: { mcpServers: {} } });\n`);
    extensionArgs = ['-e', wrapper];
  }
  if (test.fixture) {
    const fixture = join(dir, 'protocol-fixture.ts');
    await writeFile(fixture, `export default function(pi) {
      pi.registerCommand('todex-probe', {
        description: 'Deterministic protocol probe',
        getArgumentCompletions: () => [{ value: 'one', label: 'One' }],
        handler: async (_args, ctx) => {
          const selected = await ctx.ui.select('Select probe', ['A', 'B']);
          const confirmed = await ctx.ui.confirm('Confirm probe', 'Continue?');
          const input = await ctx.ui.input('Input probe', 'placeholder');
          const editor = await ctx.ui.editor('Editor probe', 'prefill');
          ctx.ui.setStatus('probe', 'Ready');
          ctx.ui.setWidget('probe', ['Line 1', 'Line 2']);
          ctx.ui.setWidget('probe-factory', () => { throw new Error('RPC must not call widget factory'); });
          ctx.ui.setTitle('Probe title');
          ctx.ui.setEditorText('Draft from extension');
          let customCalled = false;
          const custom = await ctx.ui.custom(() => { customCalled = true; });
          pi.sendMessage({ customType: 'todex-probe', content: 'Custom message before prompt ack', display: true });
          ctx.ui.notify(JSON.stringify({ mode: ctx.mode, hasUI: ctx.hasUI, selected, confirmed, input, editor, customCalled, customUndefined: custom === undefined }));
        }
      });
    }`);
    extensionArgs = ['-e', fixture];
  }
  const env = Object.fromEntries(['PATH', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  env.PI_CODING_AGENT_DIR = config;
  env.PI_TASKS = join(dir, 'tasks.json');
  const child = spawn(resolve(piBin), ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-tools', ...extensionArgs], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  const pending = new Map();
  let sequence = 0;
  let stderr = '';
  let replyIndex = 0;
  child.stderr.on('data', data => { stderr += data.toString(); });
  child.on('error', error => {
    for (const value of pending.values()) value.reject(error);
  });
  const lines = createInterface({ input: child.stdout });
  const send = value => child.stdin.write(JSON.stringify(value) + '\n');
  lines.on('line', line => {
    let event;
    try { event = JSON.parse(line); } catch { events.push({ type: 'non_json_stdout', text: line }); return; }
    events.push(event);
    if (event.type === 'response' && pending.has(event.id)) {
      pending.get(event.id).resolve(event);
      return;
    }
    if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) {
      const answer = test.replies?.[replyIndex++] ?? null;
      if (answer === null) send({ type: 'extension_ui_response', id: event.id, cancelled: true });
      else if (event.method === 'confirm') send({ type: 'extension_ui_response', id: event.id, confirmed: answer === true });
      else {
        const value = event.method === 'select' ? event.options.find(option => option === answer || option.startsWith(answer + ' ')) : answer;
        send(value === undefined ? { type: 'extension_ui_response', id: event.id, cancelled: true } : { type: 'extension_ui_response', id: event.id, value });
      }
    }
  });
  async function request(type, body = {}) {
    const id = `probe-${++sequence}`;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        timer = setTimeout(() => reject(new Error(`${type} timed out`)), 12000);
        send({ id, type, ...body });
      });
    } finally { clearTimeout(timer); pending.delete(id); }
  }
  const result = { package: test.package, version: manifest.version, commands: [] };
  try {
    const discovered = await request('get_commands');
    result.discovery = discovered.data?.commands;
    result.startupEvents = [...events];
    for (const message of test.commands) {
      const name = message.slice(1).split(' ')[0];
      if (!result.discovery?.some(command => command.name === name)) {
        result.commands.push({ message, error: 'Command not discovered; not sent as a model prompt.' });
        continue;
      }
      const start = events.length;
      const ack = await request('prompt', { message });
      const state = await request('get_state');
      result.commands.push({ message, ack, state: state.data, events: events.slice(start) });
    }
    result.files = await readdir(dir);
    try { result.taskData = JSON.parse(await readFile(join(dir, 'tasks.json'), 'utf8')); } catch {}
  } catch (error) { result.error = error.message; }
  finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    lines.close();
  }
  result.stderr = stderr;
  return result;
}

const results = [];
for (const [index, test] of cases.entries()) {
  const result = await run(test, index);
  results.push(result);
  console.log(JSON.stringify({ package: result.package, error: result.error, discovered: result.discovery?.map(c => c.name), commands: result.commands.map(c => ({ message: c.message, success: c.ack?.success, error: c.error, ui: c.events?.filter(e => e.type === 'extension_ui_request').map(e => ({ method: e.method, title: e.title, message: e.message, options: e.options })), events: c.events?.map(e => e.type), idle: c.state?.isStreaming === false })) }));
}
await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2));
console.log(`Full results: ${join(root, 'results.json')}`);
if (results.some(result => result.error || result.commands.some(command => command.error || command.ack?.success !== true || command.events?.some(event => event.type === 'extension_error')))) process.exitCode = 1;
else {
  assert(results.find(result => result.package === 'pi-cache-graph').files.includes('session.csv'));
  assert.equal(results.find(result => result.package === '@tintinweb/pi-tasks').taskData.tasks[0].subject, 'Todex RPC probe');
  const fixture = results.find(result => result.package === 'protocol-fixture').commands[0];
  const notification = fixture.events.find(event => event.method === 'notify');
  assert.deepEqual(JSON.parse(notification.message), { mode: 'rpc', hasUI: true, selected: 'B', confirmed: true, input: 'typed', editor: 'edited', customCalled: false, customUndefined: true });
  assert(fixture.events.some(event => event.type === 'message_end' && event.message?.role === 'custom'));
  assert(!fixture.events.some(event => event.type === 'agent_start'));
  console.log('Verified CSV export, task persistence, four dialog round trips, and RPC custom-UI boundary.');
}

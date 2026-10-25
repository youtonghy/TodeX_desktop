import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import {
  checksumFor,
  matchingBackendVersion,
  parseVersionOutput,
  platformLabel,
  releaseAssetName,
  releaseIsSigned,
  releaseSignatureValid,
  RELEASE_SIGNING_KEYS,
} from '../src/main/localBackend/releaseAssets.ts';
import { socketFetch, socketJson, socketWebSocket } from '../src/main/localBackend/socketHttp.ts';
import { clientPort, daemonRecord } from '../src/main/localBackend/cli.ts';

test('release assets follow the backend build matrix', () => {
  assert.equal(platformLabel('linux', 'x64'), 'linux-x64-gnu');
  assert.equal(platformLabel('darwin', 'arm64'), 'macos-arm64');
  assert.equal(platformLabel('win32', 'arm64'), 'windows-arm64');
  assert.equal(platformLabel('darwin', 'x64'), null);
  assert.equal(releaseAssetName('2.3.6', 'linux-x64-gnu'), 'todex-agentd-v2.3.6-linux-x64-gnu.bin');
  assert.equal(releaseAssetName('2.3.6', 'windows-x64'), 'todex-agentd-v2.3.6-windows-x64.exe');
});

test('backend releases after v2.3.6 must be signed by the release key for their tag', () => {
  assert.equal(releaseIsSigned('2.3.6'), false);
  assert.equal(releaseIsSigned('2.3.7'), true);
  assert.equal(releaseIsSigned('3.0.0'), true);
  assert.equal(releaseIsSigned('2.2.10'), false);
  // Signed by `openssl pkeyutl -sign -rawin` with a throwaway key, the way
  // the backend release workflow signs (the backend updater tests use it too).
  const key = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAsbGbf0A8YCNCbJ+lEI7FeayIGzTxCU/OPwBsaAx1GS4=
-----END PUBLIC KEY-----
`;
  const manifest = new TextEncoder().encode('abc  todex-agentd-v9.9.9-linux-x64.bin\n');
  const signature = Uint8Array.from(
    Buffer.from('4SRLsnVHZxYTNojV198uqeFn4WpPsHoU80dxwxE6LKW5MKIw/iBpfpkP2rgd0pQEIA3sVu/ymr6zb+xiZrykCg==', 'base64'),
  );
  assert.equal(releaseSignatureValid('v9.9.9', manifest, signature, [key]), true);
  assert.equal(releaseSignatureValid('v9.9.8', manifest, signature, [key]), false);
  assert.equal(releaseSignatureValid('v9.9.9', new TextEncoder().encode('abd'), signature, [key]), false);
  const flipped = signature.slice();
  flipped[0] ^= 1;
  assert.equal(releaseSignatureValid('v9.9.9', manifest, flipped, [key]), false);
  assert.equal(releaseSignatureValid('v9.9.9', manifest, new Uint8Array(), [key]), false);
  // The shipped release key did not sign it, and is a usable key.
  assert.equal(releaseSignatureValid('v9.9.9', manifest, signature), false);
  assert.equal(releaseSignatureValid('v9.9.9', manifest, signature, [...RELEASE_SIGNING_KEYS, key]), true);
});

test('a desktop release downloads the same backend version; dev builds take the latest', () => {
  assert.equal(matchingBackendVersion('2.3.6'), '2.3.6');
  assert.equal(matchingBackendVersion('v2.4.0'), '2.4.0');
  assert.equal(matchingBackendVersion('DEV0.0.0'), null);
  assert.equal(matchingBackendVersion('0.0.0'), null);
  assert.equal(matchingBackendVersion('2.4.0-beta.1'), null);
});

test('SHA256SUMS lookup and --version parsing', () => {
  const digest = 'a'.repeat(64);
  const sums = `${'b'.repeat(64)}  todex-agentd-v2.3.6-macos-arm64.bin\n${digest} *todex-agentd-v2.3.6-linux-x64-gnu.bin\n`;
  assert.equal(checksumFor(sums, 'todex-agentd-v2.3.6-linux-x64-gnu.bin'), digest);
  assert.equal(checksumFor(sums, 'todex-agentd-v2.3.6-windows-x64.exe'), null);
  assert.equal(parseVersionOutput('todex-agentd 2.3.6\n'), '2.3.6');
  assert.equal(parseVersionOutput('something else'), null);
});

test('HTTP and WebSocket requests reach a server on a Unix socket', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'todex-ipc-'));
  const socketPath = join(dir, 'agentd.sock');
  const seen: Array<{ method?: string; url?: string; host?: string; origin?: string; body: string }> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin as string | undefined, body });
      if (req.url === '/fail') {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'code_mismatch', message: 'wrong code' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', 'x-test': 'yes' });
      res.end(JSON.stringify({ ok: true, echo: body }));
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket, req) => {
    socket.on('message', (data, isBinary) => socket.send(isBinary ? data : `echo:${data}`, { binary: isBinary }));
    socket.send(`hello ${req.url}`);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    const response = await socketFetch(socketPath, { method: 'POST', path: '/v2/sealed?x=1', headers: { origin: 'todex-desktop://app' }, body: 'payload' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-test'), 'yes');
    assert.deepEqual(await response.json(), { ok: true, echo: 'payload' });
    assert.deepEqual(seen[0], { method: 'POST', url: '/v2/sealed?x=1', host: 'localhost', origin: 'todex-desktop://app', body: 'payload' });

    const stream = new Blob(['streamed body']).stream();
    await (await socketFetch(socketPath, { method: 'PUT', path: '/s', body: stream })).text();
    assert.equal(seen[1].body, 'streamed body');

    await assert.rejects(socketJson(socketPath, 'POST', '/fail', {}), (error: Error & { status?: number; code?: string }) => (
      error.message === 'wrong code' && error.status === 409 && error.code === 'code_mismatch'
    ));

    const socket = socketWebSocket(socketPath, '/v2/ws?tv=2', { origin: 'todex-desktop://app' });
    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on('error', reject);
      socket.on('message', (data, isBinary) => {
        messages.push(isBinary ? `binary:${Buffer.from(data as Buffer).toString('hex')}` : String(data));
        if (messages.length === 1) {
          socket.send('ping');
          socket.send(new Uint8Array([1, 2, 3]), { binary: true });
        }
        if (messages.length === 3) resolve();
      });
    });
    socket.close();
    assert.deepEqual(messages, ['hello /v2/ws?tv=2', 'echo:ping', 'binary:010203']);
  } finally {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('local-admin paths are recognized however they are spelled', async () => {
  const { isLocalAdminPath } = await import('../src/main/localBackend/adminPath.ts');
  for (const path of ['/v2/local-admin', '/v2/local-admin/status', '/v2/%6cocal-admin/status', '//v2//local-admin/x', '/V2/Local-Admin', '/v2/local-admin%2fstatus', '/v2/%E0%A4%A']) {
    assert.equal(isLocalAdminPath(path), true, path);
  }
  for (const path of ['/v2/version', '/v2/local-adminx', '/v2/sealed']) assert.equal(isLocalAdminPath(path), false, path);
});

test('daemon.json stands in for daemon status on backends without --format json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'todex-daemon-record-'));
  try {
    assert.equal(await daemonRecord(dir), null);
    writeFileSync(join(dir, 'daemon.json'), JSON.stringify({
      pid: process.pid,
      host: '0.0.0.0',
      port: 7345,
      data_dir: dir,
      started_at: '2026-10-25T05:36:53Z',
      executable: '/opt/todex-agentd',
      ipc_path: join(dir, 'agentd.sock'),
    }));
    assert.deepEqual(await daemonRecord(dir), {
      running: true,
      pid: process.pid,
      host: '0.0.0.0',
      port: 7345,
      networkEnabled: null,
      startedAt: '2026-10-25T05:36:53Z',
      executable: '/opt/todex-agentd',
      ipcPath: join(dir, 'agentd.sock'),
      outdated: false,
      apiListen: null,
    });
    // With the network off the recorded port only serves agent tools.
    writeFileSync(join(dir, 'daemon.json'), JSON.stringify({ pid: process.pid, host: '127.0.0.1', port: 40123, network_enabled: false }));
    const ipcOnly = await daemonRecord(dir);
    assert.equal(ipcOnly?.networkEnabled, false);
    assert.equal(ipcOnly && clientPort(ipcOnly), null);
    // A pid nobody runs any more: the daemon is gone.
    writeFileSync(join(dir, 'daemon.json'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 7345 }));
    assert.equal((await daemonRecord(dir))?.running, false);
    writeFileSync(join(dir, 'daemon.json'), 'not json');
    assert.equal(await daemonRecord(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

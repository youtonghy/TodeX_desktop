import assert from 'node:assert/strict';
import { test } from 'node:test';
// The protocol is a sibling checkout (the `@todex/protocol` alias points there).
import { mapBackendPathToHost, mapHostPathToBackend } from '../../TodeX_protocol/src/pathMapping.ts';
import type { PromptLinkRequest } from '../../TodeX_protocol/src/promptUploads.ts';
import { linkLocalFile, pickedHostPathToBackend, systemShellPathResolver, type HostPathContext, type LocalFileLinker } from '../src/renderer/session/hostPaths.ts';

const host: HostPathContext = { loopback: true, deployment: 'host', pathMappings: [], windows: false };
const windowsContainer: HostPathContext = {
  loopback: true,
  deployment: 'container',
  pathMappings: [{ hostPath: 'C:\\Users\\me\\code', backendPath: '/workspace/code' }],
  windows: true,
};

test('a picked folder maps into the container, or is flagged as not mounted', () => {
  assert.deepEqual(
    pickedHostPathToBackend(windowsContainer, 'c:\\users\\me\\code\\app', mapHostPathToBackend),
    { path: '/workspace/code/app', unmounted: false },
  );
  assert.deepEqual(
    pickedHostPathToBackend(windowsContainer, 'D:\\other', mapHostPathToBackend),
    { path: 'D:\\other', unmounted: true },
  );
});

test('picked folders pass through without mappings or off loopback', () => {
  assert.deepEqual(pickedHostPathToBackend(host, '/home/me/app', mapHostPathToBackend), { path: '/home/me/app', unmounted: false });
  // Original-path container mounts publish no mappings: the backend decides.
  assert.deepEqual(
    pickedHostPathToBackend({ ...host, deployment: 'container' }, '/home/me/app', mapHostPathToBackend),
    { path: '/home/me/app', unmounted: false },
  );
  assert.deepEqual(
    pickedHostPathToBackend({ ...windowsContainer, loopback: false }, 'D:\\other', mapHostPathToBackend),
    { path: 'D:\\other', unmounted: false },
  );
});

test('shell actions open the host path a container path maps to', () => {
  const resolve = systemShellPathResolver(windowsContainer, mapBackendPathToHost);
  assert.ok(resolve);
  assert.equal(resolve('/workspace/code/app/main.rs'), 'C:\\Users\\me\\code\\app\\main.rs');
  // A container path no mapping covers does not exist here.
  assert.equal(resolve('/home/todex/.todex-agent/workspace/x'), null);
});

test('shell actions are unavailable off loopback and on a container without mappings', () => {
  assert.equal(systemShellPathResolver({ ...host, loopback: false }, mapBackendPathToHost), null);
  assert.equal(systemShellPathResolver({ ...host, deployment: 'container' }, mapBackendPathToHost), null);
});

test('a host backend opens its own paths, mapped or not', () => {
  const resolve = systemShellPathResolver(host, mapBackendPathToHost);
  assert.ok(resolve);
  assert.equal(resolve('/home/me/app/a.ts'), '/home/me/app/a.ts');
  const mapped = systemShellPathResolver({ ...host, pathMappings: [{ hostPath: '/Users/me', backendPath: '/home/me' }] }, mapBackendPathToHost);
  assert.equal(mapped?.('/home/me/app'), '/Users/me/app');
  assert.equal(mapped?.('/srv/data'), '/srv/data');
});

// --- Linking files on this machine in place (POST /v2/uploads/link) ---

function linker(reply: (request: PromptLinkRequest) => Promise<unknown>) {
  const requests: PromptLinkRequest[] = [];
  const value: LocalFileLinker = {
    link: async (request) => {
      requests.push(request);
      return await reply(request) as Awaited<ReturnType<LocalFileLinker['link']>>;
    },
    fingerprint: (head) => `head:${new TextDecoder().decode(head)}`,
    fingerprintBytes: 4,
    mapHostPathToBackend,
  };
  return { value, requests };
}

const stored = (path: string) => ({ uploadId: 'l1', path, name: 'a.txt', mimeType: 'text/plain', sizeBytes: 6 });

test('a file on this machine is linked with its size and head fingerprint', async () => {
  const { value, requests } = linker(async (request) => stored(request.path));
  const linked = await linkLocalFile(value, host, { hostPath: '/Users/me/a.txt', blob: new Blob(['abcdef']), conversationId: 'p1' });
  assert.equal(linked?.path, '/Users/me/a.txt');
  assert.deepEqual(requests, [{ path: '/Users/me/a.txt', sizeBytes: 6, headSha256: 'head:abcd', conversationId: 'p1' }]);
});

test('a container sees the file at its mapped path, and an unmounted one is not linked', async () => {
  const { value, requests } = linker(async (request) => stored(request.path));
  const mapped = await linkLocalFile(value, windowsContainer, { hostPath: 'C:\\Users\\me\\code\\a.txt', blob: new Blob(['x']) });
  assert.equal(mapped?.path, '/workspace/code/a.txt');
  const outside = await linkLocalFile(value, windowsContainer, { hostPath: 'D:\\other\\a.txt', blob: new Blob(['x']) });
  assert.equal(outside, null);
  assert.equal(requests.length, 1);
});

test('remote backends, files without a path and refusals fall back to uploading', async () => {
  const { value, requests } = linker(async () => { throw Object.assign(new Error('conflict'), { httpStatus: 409 }); });
  assert.equal(await linkLocalFile(value, { ...host, loopback: false }, { hostPath: '/Users/me/a.txt', blob: new Blob(['x']) }), null);
  assert.equal(await linkLocalFile(value, host, { hostPath: '', blob: new Blob(['x']) }), null);
  assert.equal(requests.length, 0);
  // Another machine behind a loopback tunnel: the daemon refuses the link.
  assert.equal(await linkLocalFile(value, host, { hostPath: '/Users/me/a.txt', blob: new Blob(['x']) }), null);
  assert.equal(requests.length, 1);
});

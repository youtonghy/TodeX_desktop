import assert from 'node:assert/strict';
import { test } from 'node:test';
// The protocol is a sibling checkout (the `@todex/protocol` alias points there).
import { mapBackendPathToHost, mapHostPathToBackend } from '../../TodeX_protocol/src/pathMapping.ts';
import { pickedHostPathToBackend, systemShellPathResolver, type HostPathContext } from '../src/renderer/session/hostPaths.ts';

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

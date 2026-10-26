import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ipcDaemonConflicts,
  moveBackendRecords,
  ownerBackendId,
  resolveNoWorkspaceBackendId,
  tagLegacyBackendRecords,
} from '../src/renderer/session/backendRouting.ts';

const profiles = [
  { id: 'b2', createdAt: 20 },
  { id: 'b1', createdAt: 10 },
];

test('the no-workspace backend is the chosen one, else the first added', () => {
  assert.equal(resolveNoWorkspaceBackendId(profiles, 'b2'), 'b2');
  assert.equal(resolveNoWorkspaceBackendId(profiles, ''), 'b1');
  // A removed choice falls back to the first added backend.
  assert.equal(resolveNoWorkspaceBackendId(profiles, 'gone'), 'b1');
  assert.equal(resolveNoWorkspaceBackendId([], 'b1'), '');
});

test('the None row in view wins over the Settings default while it exists', () => {
  assert.equal(resolveNoWorkspaceBackendId(profiles, 'b1', 'b2'), 'b1');
  assert.equal(resolveNoWorkspaceBackendId(profiles, null, 'gone', 'b2'), 'b2');
  assert.equal(resolveNoWorkspaceBackendId(profiles, 'gone', ''), 'b1');
});

test('a conversation belongs to its own tag, then its workspace, then the no-workspace backend', () => {
  assert.equal(ownerBackendId({ workspaceId: 'w', backendConnectionId: 'b2' }, { id: 'w', backendConnectionId: 'b1' }, 'b9'), 'b2');
  assert.equal(ownerBackendId({ workspaceId: 'w' }, { id: 'w', backendConnectionId: 'b1' }, 'b9'), 'b1');
  assert.equal(ownerBackendId({ workspaceId: 'workspace-none' }, { id: 'workspace-none', backendConnectionId: null }, 'b9'), 'b9');
  assert.equal(ownerBackendId(undefined, undefined, 'b9'), 'b9');
});

test('legacy records are tagged with the backend that was active', () => {
  const none = { id: 'workspace-none', backendConnectionId: null };
  const tagged = { id: 'w1', backendConnectionId: 'b2' };
  const untagged = { id: 'w2' };
  const records = {
    workspaces: [tagged, untagged, none],
    conversations: [
      { workspaceId: 'w2', v2ConversationId: 'c1' },
      { workspaceId: 'workspace-none', v2ConversationId: 'c2' },
      { workspaceId: 'workspace-none' },
      { workspaceId: 'workspace-none', v2ConversationId: 'c3', backendConnectionId: 'b2' },
    ],
    tombstones: [{ backendConnectionId: null }, { backendConnectionId: 'b2' }],
  };
  const result = tagLegacyBackendRecords(records, 'b1');
  assert.deepEqual(result.workspaces.map((item) => item.backendConnectionId), ['b2', 'b1', null]);
  // Conversations in a workspace follow it; None-workspace conversations on
  // a backend get its tag; local None drafts stay untagged.
  assert.deepEqual(result.conversations.map((item) => item.backendConnectionId), [undefined, 'b1', undefined, 'b2']);
  assert.deepEqual(result.tombstones.map((item) => item.backendConnectionId), ['b1', 'b2']);
  assert.equal(result.workspaces[0], tagged);
});

test('tagging keeps the inputs when nothing is untagged', () => {
  const records = { workspaces: [{ id: 'w1', backendConnectionId: 'b1' }], conversations: [], tombstones: [] };
  const result = tagLegacyBackendRecords(records, 'b1');
  assert.equal(result.workspaces, records.workspaces);
  assert.equal(tagLegacyBackendRecords(records, '').workspaces, records.workspaces);
});


const isIpc = (url: string) => url.startsWith('todex-ipc://');
const daemonProfile = (id: string, serverUrl: string, key = '', extra: { disabled?: boolean } = {}) => ({
  id, serverUrl, createdAt: 0, encryptionPublicKey: key, transportVerified: Boolean(key), ...extra,
});

test('an IPC profile takes over the TCP profiles of its daemon', () => {
  const profiles = [
    daemonProfile('http', 'http://127.0.0.1:7345', 'k1'),
    daemonProfile('remote', 'https://remote.example', 'k2'),
    daemonProfile('ipc', 'todex-ipc://local', 'k1'),
  ];
  assert.deepEqual(ipcDaemonConflicts(profiles, isIpc), [{ loserId: 'http', winnerId: 'ipc' }]);
  // A disabled side is no conflict, so a swap back to TCP sticks.
  assert.deepEqual(ipcDaemonConflicts([{ ...profiles[0] }, { ...profiles[2], disabled: true }], isIpc), []);
  // Before the IPC profile pins a key, only the daemon's own listener counts.
  const unpaired = [daemonProfile('http', 'http://127.0.0.1:7345'), daemonProfile('ipc', 'todex-ipc://local')];
  assert.deepEqual(ipcDaemonConflicts(unpaired, isIpc), []);
  assert.deepEqual(
    ipcDaemonConflicts(unpaired, isIpc, (_ipc, url) => url === 'http://127.0.0.1:7345'),
    [{ loserId: 'http', winnerId: 'ipc' }],
  );
});

test('moved records keep one copy of each id the daemon issued', () => {
  const moved = moveBackendRecords({
    workspaces: [
      { id: 'ws_a', backendConnectionId: 'http' },
      { id: 'ws_b', backendConnectionId: 'http' },
      { id: 'ws_a', backendConnectionId: 'ipc' },
      { id: 'ws_c', backendConnectionId: 'other' },
    ],
    conversations: [
      { id: 'c1', workspaceId: 'ws_a', backendConnectionId: 'http', v2ConversationId: 'v1' },
      { id: 'c2', workspaceId: 'ws_b', backendConnectionId: 'http', v2ConversationId: 'v2' },
      { id: 'c3', workspaceId: 'ws_a', backendConnectionId: 'ipc', v2ConversationId: 'v1' },
      { id: 'c4', workspaceId: 'ws_b' },
    ],
    tombstones: [{ backendConnectionId: 'http' }],
  }, 'http', 'ipc');
  assert.deepEqual(moved.workspaces, [
    { id: 'ws_b', backendConnectionId: 'ipc' },
    { id: 'ws_a', backendConnectionId: 'ipc' },
    { id: 'ws_c', backendConnectionId: 'other' },
  ]);
  assert.deepEqual(moved.conversations.map((item) => [item.id, item.backendConnectionId]), [
    ['c2', 'ipc'],
    ['c3', 'ipc'],
    ['c4', undefined],
  ]);
  assert.deepEqual([...moved.conversationIds], [['c1', 'c3']]);
  assert.deepEqual(moved.tombstones, [{ backendConnectionId: 'ipc' }]);
});

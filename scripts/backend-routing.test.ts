import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ipcDaemonConflicts,
  isStandbyProfile,
  moveBackendRecords,
  orphanedStandbyProfiles,
  ownerBackendId,
  resolveNoWorkspaceBackendId,
  reusableNativeProfile,
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

test('connecting the native daemon reuses its paired loopback profile', () => {
  const profile = (id: string, serverUrl: string, extra: Record<string, unknown> = {}) => ({
    id, serverUrl, createdAt: 1, updatedAt: 1, encryptionPublicKey: 'k', transportVerified: true, paired: true, ...extra,
  });
  const isIpc = (url: string) => url.startsWith('todex-ipc://');
  const reachesNative = (url: string) => url === 'http://127.0.0.1:7345';
  const isPaired = (item: { paired: boolean }) => item.paired;
  const pick = (items: ReturnType<typeof profile>[]) => reusableNativeProfile(items, isIpc, reachesNative, isPaired)?.id;

  assert.equal(pick([profile('remote', 'http://10.0.0.2:7345'), profile('ipc', 'todex-ipc://local')]), undefined);
  assert.equal(pick([profile('unpaired', 'http://127.0.0.1:7345', { paired: false })]), undefined);
  assert.equal(pick([profile('loop', 'http://127.0.0.1:7345')]), 'loop');
  // Enabled before disabled, then the most recently updated.
  assert.equal(pick([
    profile('old', 'http://127.0.0.1:7345', { updatedAt: 5 }),
    profile('off', 'http://127.0.0.1:7345', { updatedAt: 9, disabled: true }),
    profile('new', 'http://127.0.0.1:7345', { updatedAt: 7 }),
  ]), 'new');
  assert.equal(pick([profile('off', 'http://127.0.0.1:7345', { disabled: true })]), 'off');
});

test('a group node served over IPC loses to the IPC profile and becomes its standby', () => {
  const node = (id: string, nodeId: string, key = '', extra: { disabled?: boolean } = {}) => ({
    ...daemonProfile(id, `http://192.168.1.5:7345/${id}`, key, extra), mesh: { nodeId },
  });
  const ipc = daemonProfile('ipc', 'todex-ipc://local');
  // Matched by the node id the IPC daemon reported, even without a pinned key.
  const nodeOf = (id: string) => (id === 'ipc' ? 'node_local' : undefined);
  assert.deepEqual(ipcDaemonConflicts([ipc, node('local', 'node_local'), node('remote', 'node_remote')], isIpc, undefined, nodeOf), [
    { loserId: 'local', winnerId: 'ipc' },
  ]);
  // Or by the transport key, as any profile of the daemon.
  assert.deepEqual(ipcDaemonConflicts([daemonProfile('ipc', 'todex-ipc://local', 'k1'), node('local', 'node_x', 'k1')], isIpc), [
    { loserId: 'local', winnerId: 'ipc' },
  ]);
  assert.equal(isStandbyProfile(node('local', 'node_local', '', { disabled: true })), true);
  assert.equal(isStandbyProfile(daemonProfile('tcp', 'http://127.0.0.1:7345', '', { disabled: true })), false);
  assert.equal(isStandbyProfile(node('local', 'node_local')), false);
});

test('a standby carries the data again once no IPC profile serves its daemon', () => {
  const standby = { ...daemonProfile('local', 'http://192.168.1.5:7345', 'k1', { disabled: true }), mesh: { nodeId: 'node_local' } };
  const ids = (items: { id: string }[]) => items.map((item) => item.id);
  // Served by key, by node id, or by an IPC profile not connected yet: stays.
  assert.deepEqual(ids(orphanedStandbyProfiles([standby, daemonProfile('ipc', 'todex-ipc://local', 'k1')], isIpc, () => 'node_other')), []);
  assert.deepEqual(ids(orphanedStandbyProfiles([standby, daemonProfile('ipc', 'todex-ipc://local')], isIpc, () => 'node_local')), []);
  assert.deepEqual(ids(orphanedStandbyProfiles([standby, daemonProfile('ipc', 'todex-ipc://local')], isIpc)), []);
  // The IPC profile was removed, disabled, or serves another node.
  assert.deepEqual(ids(orphanedStandbyProfiles([standby], isIpc)), ['local']);
  assert.deepEqual(ids(orphanedStandbyProfiles([standby, daemonProfile('ipc', 'todex-ipc://local', 'k1', { disabled: true })], isIpc)), ['local']);
  assert.deepEqual(ids(orphanedStandbyProfiles([standby, daemonProfile('ipc', 'todex-ipc://box', 'k2')], isIpc, () => 'node_box')), ['local']);
});

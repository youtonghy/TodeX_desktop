import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
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


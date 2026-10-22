import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationPermissionMode, isPermissionMode, PERMISSION_MODES } from '../src/renderer/session/permissions.ts';

// A backend whose provider default (ask) differs from the user's choice.
const providers = [{
  id: 'claude-code',
  capabilities: { permissionConfig: { modes: ['ask', 'auto', 'full-access'], defaultMode: 'ask', supportsPlan: true } },
}] as never;
const workspace = { id: 'w', sandboxMode: 'workspace-write', approvalPolicy: 'on-request' } as never;
const record = (permissionMode?: string) => ({ id: 'c', provider: 'claude-code', ...(permissionMode ? { permissionMode } : {}) }) as never;

test('a record with its own mode keeps it', () => {
  assert.equal(conversationPermissionMode(record('full-access'), workspace, providers, 'auto'), 'full-access');
});

test('a record without a mode follows the remembered one, not the provider default', () => {
  assert.equal(conversationPermissionMode(record(), workspace, providers, 'auto'), 'auto');
  assert.equal(conversationPermissionMode(record(), workspace, providers), 'ask');
});

test('a remembered mode the agent no longer offers falls back to its default', () => {
  const askOnly = [{ id: 'claude-code', capabilities: { permissionConfig: { modes: ['ask'], defaultMode: 'ask' } } }] as never;
  assert.equal(conversationPermissionMode(record(), workspace, askOnly, 'auto'), 'ask');
});

test('legacy workspace permissions still win over the remembered mode', () => {
  assert.equal(conversationPermissionMode(record(), { id: 'w', sandboxMode: 'read-only' } as never, providers, 'auto'), null);
  assert.equal(conversationPermissionMode(record(), { id: 'w', permissionProfile: ':workspace' } as never, providers, 'auto'), 'ask');
});

test('accept-edits is kept only when the agent declares it', () => {
  const withAcceptEdits = [{
    id: 'claude-code',
    capabilities: { permissionConfig: { modes: ['ask', 'accept-edits', 'auto', 'full-access'], defaultMode: 'ask' } },
  }] as never;
  assert.equal(conversationPermissionMode(record('accept-edits'), workspace, withAcceptEdits), 'accept-edits');
  assert.equal(conversationPermissionMode(record(), workspace, withAcceptEdits, 'accept-edits'), 'accept-edits');
  assert.equal(conversationPermissionMode(record('accept-edits'), workspace, providers), null);
  assert.equal(conversationPermissionMode(record(), workspace, providers, 'accept-edits'), 'ask');
});

test('isPermissionMode knows accept-edits but not CLI-only modes', () => {
  assert.equal(isPermissionMode('accept-edits'), true);
  assert.equal(isPermissionMode('bypassPermissions'), false);
  assert.deepEqual(PERMISSION_MODES, ['ask', 'accept-edits', 'auto', 'full-access']);
});

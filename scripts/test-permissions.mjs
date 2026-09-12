import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationPermissionMode as resolve, conversationPermissionCapabilities as capabilities, rememberedRunModes } from '../src/renderer/session/permissions.ts';
const providers = [{ id: 'codex', capabilities: { permissionConfig: { modes: ['ask', 'auto', 'full-access'], defaultMode: 'ask', supportsPlan: true } } }, { id: 'pi', capabilities: { permissionConfig: { modes: ['full-access'], defaultMode: 'full-access', supportsPlan: false } } }];
test('defaults come only from supported backend capabilities', () => {
  assert.equal(resolve({ provider: 'codex' }, {}, providers), 'ask');
  assert.equal(resolve({ provider: 'pi' }, {}, providers), 'full-access');
  assert.equal(resolve({ provider: 'unknown' }, {}, providers), null);
  assert.equal(resolve({ provider: 'codex' }, {}, [{ id: 'codex', capabilities: { permissionConfig: { modes: ['ask'], defaultMode: 'auto' } } }]), null);
});
test('legacy read-only and custom profiles require an explicit supported selection', () => {
  for (const provider of ['codex', 'pi']) {
    assert.equal(resolve({ provider }, { sandboxMode: 'read-only' }, providers), null);
    assert.equal(resolve({ provider }, { permissionProfile: 'company-restricted' }, providers), null);
  }
  assert.equal(resolve({ provider: 'pi', permissionMode: 'full-access' }, { sandboxMode: 'read-only' }, providers), 'full-access');
});
test('preserves full access and auto-review while rejecting unsupported selections', () => {
  assert.equal(resolve({ provider: 'codex' }, { permissionProfile: ':danger-full-access', approvalPolicy: 'never' }, providers), 'full-access');
  assert.equal(resolve({ provider: 'codex' }, { permissionProfile: ':workspace', approvalsReviewer: 'auto_review' }, providers), 'auto');
  assert.equal(resolve({ provider: 'pi', permissionMode: 'ask' }, {}, providers), null);
  assert.equal(resolve({ provider: 'codex', permissionMode: 'ask' }, { sandboxMode: 'danger-full-access' }, providers), 'ask');
});
test('plan availability reflects the selected provider', () => {
  assert.equal(capabilities({ provider: 'codex' }, providers).supportsPlan, true);
  assert.equal(capabilities({ provider: 'pi' }, providers).supportsPlan, false);
  assert.equal(capabilities({ provider: 'unknown' }, providers), undefined);
});

test('custom legacy combinations never silently lose an approval or sandbox constraint', () => {
  for (const config of [
    { sandboxMode: 'danger-full-access', approvalPolicy: 'on-request' },
    { sandboxMode: 'danger-full-access', approvalPolicy: 'untrusted' },
    { sandboxMode: 'external-sandbox' },
    { approvalPolicy: 'on-failure' },
    { approvalsReviewer: 'company-reviewer' },
    { permissionProfile: ':workspace', approvalPolicy: 'never' },
    { permissionProfile: ':danger-full-access', sandboxMode: 'workspace-write', approvalPolicy: 'never' },
  ]) assert.equal(resolve({ provider: 'codex' }, config, providers), null);
});

test('remembered run modes apply only while the provider still supports them', () => {
  const codex = providers[0].capabilities.permissionConfig;
  const pi = providers[1].capabilities.permissionConfig;
  assert.deepEqual(
    rememberedRunModes({ reasoningByModel: {}, lastPermissionMode: 'auto', lastWorkMode: 'plan' }, codex),
    { permissionMode: 'auto', mode: 'plan' });
  assert.deepEqual(
    rememberedRunModes({ reasoningByModel: {}, lastPermissionMode: 'auto', lastWorkMode: 'plan' }, pi),
    { permissionMode: 'full-access', mode: 'implement' });
  assert.deepEqual(rememberedRunModes(undefined, codex), { permissionMode: 'ask', mode: 'implement' });
  assert.deepEqual(rememberedRunModes({ reasoningByModel: {}, lastWorkMode: 'implement' }, codex), { permissionMode: 'ask', mode: 'implement' });
  assert.deepEqual(rememberedRunModes({ reasoningByModel: {}, lastPermissionMode: 'auto' }, undefined), { permissionMode: undefined, mode: 'implement' });
});

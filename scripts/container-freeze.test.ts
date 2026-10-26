import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendActive, idleExpired } from '../src/renderer/session/containerIdle.ts';
import { detectTemplates, setupScript, templateText } from '../src/renderer/session/containerSetup.ts';

const base = {
  workspaces: [{ id: 'w1', backendConnectionId: 'c1' }, { id: 'w2', backendConnectionId: 'other' }],
  conversations: [{ id: 'a', workspaceId: 'w1', nativeStatus: 'idle' }, { id: 'b', workspaceId: 'w2', nativeStatus: 'running' }],
  conversationRuntimeById: {},
  terminalById: {},
};

test('a container backend is active while turns, terminals or daemon-held prompts run on it', () => {
  assert.equal(backendActive(base, ['c1']), false, 'another backend running does not count');
  assert.equal(backendActive({ ...base, conversations: [{ id: 'a', workspaceId: 'w1', nativeStatus: 'waiting_permission' }] }, ['c1']), true);
  assert.equal(backendActive({ ...base, conversationRuntimeById: { a: { followUps: { items: [{}] } } } }, ['c1']), true, 'queued or scheduled prompt');
  assert.equal(backendActive({ ...base, conversationRuntimeById: { a: { followUps: { items: [] } } } }, ['c1']), false);
  assert.equal(backendActive({ ...base, terminalById: { t: { backendConnectionId: 'c1', status: 'running' } } }, ['c1']), true);
  assert.equal(backendActive({ ...base, terminalById: { t: { backendConnectionId: 'c1', status: 'exited' } } }, ['c1']), false);
});

test('idle time expires after the chosen minutes; 0 never freezes', () => {
  assert.equal(idleExpired(0, 30 * 60_000, 30), true);
  assert.equal(idleExpired(0, 30 * 60_000 - 1, 30), false);
  assert.equal(idleExpired(0, 10 ** 12, 0), false);
});

test('setup templates follow the folder files', () => {
  assert.deepEqual(detectTemplates(['package.json', 'pnpm-lock.yaml', '.gitmodules']), ['submodules', 'pnpm']);
  assert.deepEqual(detectTemplates(['package.json', 'package-lock.json']), ['npm']);
  assert.deepEqual(detectTemplates(['package.json']), ['npm-install']);
  assert.deepEqual(detectTemplates(['pyproject.toml', 'requirements.txt']), ['uv']);
  assert.deepEqual(detectTemplates(['requirements.txt', 'yarn.lock']), ['yarn', 'requirements']);
  assert.deepEqual(detectTemplates([]), []);
  // uv's installer line appears once when two Python templates are combined.
  assert.equal(templateText(['uv', 'requirements']).split('\n').filter((line) => line.includes('astral.sh')).length, 1);
});

test('setup scripts stop at the first failure and skip blank lines and comments', () => {
  assert.equal(setupScript('  # deps\n\npnpm install\n  npm test  \n'), 'set -ex\npnpm install\nnpm test');
  assert.equal(setupScript('\n# nothing\n'), '');
});

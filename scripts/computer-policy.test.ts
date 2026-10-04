import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTarget, checkUserActive, supportedOs, toScreenPoint } from '../src/main/agentDesktop/computerPolicy.ts';

const textEdit = { bundleId: 'com.apple.TextEdit', name: 'TextEdit', pid: 50 };

test('blocked apps and TodeX itself are refused before anything else', () => {
  assert.equal(checkTarget({ bundleId: 'com.apple.keychainaccess', name: 'Keychain Access', pid: 9 }, ['com.apple.keychainaccess'], 1)?.code, 'TARGET_BLOCKED');
  assert.equal(checkTarget({ bundleId: 'com.unknown.renamed', name: 'TodeX', pid: 1 }, [], 1)?.code, 'TARGET_BLOCKED');
  assert.equal(checkTarget({ bundleId: 'com.unbaked0692.todexdesktop', name: 'TodeX', pid: 2 }, [], 1)?.code, 'TARGET_BLOCKED');
});

test('the first action in an app asks; approved apps pass', () => {
  const failure = checkTarget(textEdit, [], 1);
  assert.equal(failure?.code, 'APP_CONFIRM');
  assert.deepEqual(failure?.detail, { bundleId: 'com.apple.TextEdit', name: 'TextEdit' });
  assert.equal(checkTarget(textEdit, ['com.apple.TextEdit'], 1), null);
  assert.equal(checkTarget({ bundleId: '', name: '', pid: 0 }, [], 1), null);
});

test('only pointer actions wait for an idle user', () => {
  assert.equal(checkUserActive('click', true, 0.5)?.code, 'USER_ACTIVE');
  assert.equal(checkUserActive('drag', false, 0.5)?.code, 'USER_ACTIVE');
  assert.equal(checkUserActive('click', false, 0.5), null, 'ref clicks run in the background');
  assert.equal(checkUserActive('type', false, 0), null);
  assert.equal(checkUserActive('click', true, 3), null);
});

test('screenshot pixels map to global points', () => {
  const mapping = { originX: 100, originY: 50, pointsPerPixel: 0.5, width: 1280, height: 800 };
  assert.deepEqual(toScreenPoint(mapping, 200, 100), { x: 200, y: 100 });
  assert.equal(toScreenPoint(mapping, -1, 0), null);
  assert.equal(toScreenPoint(mapping, 1281, 0), null);
  assert.equal(toScreenPoint(mapping, Number.NaN, 0), null);
});

test('Computer Use needs macOS 14 or later', () => {
  assert.equal(supportedOs('darwin', '23.0.0'), true);
  assert.equal(supportedOs('darwin', '27.0.1'), true);
  assert.equal(supportedOs('darwin', '22.6.0'), false);
  assert.equal(supportedOs('win32', '10.0.0'), false);
});

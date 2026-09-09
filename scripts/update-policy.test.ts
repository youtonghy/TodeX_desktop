import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAutoUpdate, createUpdateCheck, isNewerRelease } from '../src/main/updatePolicy.ts';

test('only matching versioned packaged builds can contact releases', () => {
  assert.equal(canAutoUpdate(true, '1.2.3', '1.2.3'), true);
  for (const version of ['DEV0.0.0', '0.0.0', '', 'v1.2.3', '1.2', '01.2.3', '1.2.3-beta.1', '1.2.3+local']) {
    assert.equal(canAutoUpdate(true, version, version), false, version);
  }
  assert.equal(canAutoUpdate(false, '1.2.3', '1.2.3'), false);
  assert.equal(canAutoUpdate(true, '1.2.3', '0.0.0'), false);
});

test('stable versions increase numerically; equal, older and prerelease versions are ignored', () => {
  assert.equal(isNewerRelease('1.9.9', '1.10.0'), true);
  assert.equal(isNewerRelease('1.9.9', '2.0.0'), true);
  for (const candidate of ['1.9.9', '1.9.8', '0.9.9', '2.0.0-beta.1', '2.0.0+dev']) {
    assert.equal(isNewerRelease('1.9.9', candidate), false);
  }
});

test('concurrent checks share download and preserve a staged update until exit', async () => {
  let checks = 0;
  let downloads = 0;
  const check = createUpdateCheck({
    async checkForUpdates() { checks += 1; return { updateInfo: { version: '1.10.0' } }; },
    async downloadUpdate() { downloads += 1; },
  }, '1.9.0');
  const first = check();
  assert.equal(first, check());
  assert.match(await first, /1.10.0/);
  await check();
  assert.equal(checks, 1);
  assert.equal(downloads, 1);
});

test('failed downloads remain retryable and are never reported as staged', async () => {
  let downloads = 0;
  const check = createUpdateCheck({
    async checkForUpdates() { return { updateInfo: { version: '2.0.0' } }; },
    async downloadUpdate() { if (++downloads === 1) throw new Error('checksum mismatch'); },
  }, '1.0.0');
  await assert.rejects(check(), /checksum mismatch/);
  assert.match(await check(), /2.0.0/);
  assert.equal(downloads, 2);
});

test('checks never download ineligible release versions', async () => {
  for (const version of ['1.0.0', '0.9.0', '2.0.0-beta.1', 'DEV0.0.0']) {
    const check = createUpdateCheck({
      async checkForUpdates() { return { updateInfo: { version } }; },
      async downloadUpdate() { assert.fail(`downloaded ${version}`); },
    }, '1.0.0');
    await check();
  }
});

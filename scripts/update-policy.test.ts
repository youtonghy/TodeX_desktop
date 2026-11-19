import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canAutoUpdate, createUpdateController, createVerifiedUpdater, isNewerRelease, type InstallingUpdater } from '../src/main/updatePolicy.ts';

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

function fakeUpdater(version: string, download: () => Promise<unknown> = async () => {}) {
  const calls = { checks: 0, downloads: 0 };
  return {
    calls,
    updater: {
      async checkForUpdates() { calls.checks += 1; return { updateInfo: { version } }; },
      async downloadUpdate() { calls.downloads += 1; return download(); },
    },
  };
}

test('concurrent checks share one download and keep a staged update until exit', async () => {
  const { calls, updater } = fakeUpdater('1.10.0');
  const seen: string[] = [];
  const controller = createUpdateController(updater, '1.9.0', { autoDownload: true, onChange: (state) => seen.push(state.status) });
  const first = controller.check();
  assert.equal(first, controller.check());
  const state = await first;
  assert.equal(state.status, 'downloaded');
  assert.equal(state.version, '1.10.0');
  assert.deepEqual(seen, ['checking', 'available', 'downloading', 'downloaded']);
  await controller.check();
  assert.equal(calls.checks, 1);
  assert.equal(calls.downloads, 1);
});

test('without auto-download a check only reports the release until asked', async () => {
  const { calls, updater } = fakeUpdater('2.0.0');
  const controller = createUpdateController(updater, '1.0.0', { autoDownload: false, now: () => 42 });
  const found = await controller.check();
  assert.equal(found.status, 'available');
  assert.equal(found.lastChecked, 42);
  assert.equal(calls.downloads, 0);
  assert.equal((await controller.download()).status, 'downloaded');
});

test('failed downloads are reported, keep the version and remain retryable', async () => {
  let attempt = 0;
  const { calls, updater } = fakeUpdater('2.0.0', async () => { if (++attempt === 1) throw new Error('checksum mismatch'); });
  const controller = createUpdateController(updater, '1.0.0', { autoDownload: true });
  const failed = await controller.check();
  assert.equal(failed.status, 'error');
  assert.equal(failed.version, '2.0.0');
  assert.match(failed.error ?? '', /checksum mismatch/);
  assert.equal((await controller.download()).status, 'downloaded');
  assert.equal(calls.downloads, 2);
});

test('download progress is clamped, whole-percent and only while downloading', async () => {
  let finish: () => void = () => {};
  const { updater } = fakeUpdater('2.0.0', () => new Promise<void>((resolve) => { finish = resolve; }));
  const updates: Array<number | undefined> = [];
  const controller = createUpdateController(updater, '1.0.0', { autoDownload: true, onChange: (state) => updates.push(state.progress) });
  controller.setProgress(50);
  assert.equal(controller.getState().progress, undefined);
  const done = controller.check();
  await new Promise((resolve) => setImmediate(resolve));
  controller.setProgress(12.4);
  controller.setProgress(12.9);
  controller.setProgress(140);
  assert.equal(controller.getState().progress, 100);
  finish();
  await done;
  assert.deepEqual(updates.filter((value) => value !== undefined), [0, 12, 100, 100]);
});

test('failed checks are reported and never download', async () => {
  const controller = createUpdateController({
    async checkForUpdates() { throw new Error('offline'); },
    async downloadUpdate() { assert.fail('downloaded'); },
  }, '1.0.0', { autoDownload: true });
  const state = await controller.check();
  assert.equal(state.status, 'error');
  assert.equal(state.version, undefined);
  assert.equal((await controller.download()).status, 'error');
});

test('checks never download ineligible release versions', async () => {
  for (const version of ['1.0.0', '0.9.0', '2.0.0-beta.1', 'DEV0.0.0']) {
    const controller = createUpdateController({
      async checkForUpdates() { return { updateInfo: { version } }; },
      async downloadUpdate() { assert.fail(`downloaded ${version}`); },
    }, '1.0.0', { autoDownload: true });
    assert.equal((await controller.check()).status, 'idle');
  }
});

/** A fake electron-updater: `addQuitHandler` registers only while
 * install-on-quit is on, as BaseUpdater's does. */
function fakeInstallingUpdater() {
  let listener: ((event: { downloadedFile: string; version: string }) => void) | undefined;
  const updater = {
    autoInstallOnAppQuit: true,
    quitHandlerAdded: false,
    checkForUpdates: async () => null,
    downloadUpdate: async () => { listener?.({ downloadedFile: '/tmp/TodeX-2.0.0.exe', version: '2.0.0' }); },
    on: (_event: 'update-downloaded', next: typeof listener) => { listener = next; },
    addQuitHandler() { if (updater.autoInstallOnAppQuit) updater.quitHandlerAdded = true; },
  };
  return updater;
}

const verifiedOptions = (platform: string, verify: () => Promise<void>, discarded: string[] = []) => ({
  platform,
  verify,
  discard: async (file: string) => { discarded.push(file); },
  unverified: (reason: string) => new Error(`unverified: ${reason}`),
});

test('a verified download installs on quit outside macOS', async () => {
  for (const platform of ['win32', 'linux']) {
    const updater = fakeInstallingUpdater();
    await createVerifiedUpdater(updater as InstallingUpdater, verifiedOptions(platform, async () => undefined)).downloadUpdate();
    assert.equal(updater.autoInstallOnAppQuit, true, platform);
    assert.equal(updater.quitHandlerAdded, true, platform);
  }
  // Squirrel.Mac installs only through an explicit quitAndInstall.
  const mac = fakeInstallingUpdater();
  await createVerifiedUpdater(mac as InstallingUpdater, verifiedOptions('darwin', async () => undefined)).downloadUpdate();
  assert.equal(mac.autoInstallOnAppQuit, false);
  assert.equal(mac.quitHandlerAdded, false);
});

test('an unverified download is discarded and never installs on quit', async () => {
  const updater = fakeInstallingUpdater();
  const discarded: string[] = [];
  const verified = createVerifiedUpdater(updater as InstallingUpdater, verifiedOptions('win32', async () => { throw new Error('bad signature'); }, discarded));
  await assert.rejects(verified.downloadUpdate(), /unverified: bad signature/);
  assert.deepEqual(discarded, ['/tmp/TodeX-2.0.0.exe']);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.quitHandlerAdded, false);
});

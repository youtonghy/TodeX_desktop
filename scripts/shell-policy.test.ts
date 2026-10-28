import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPathRefusal, shellPathRefusal } from '../src/main/shellPolicy.ts';

const file = { isDirectory: false, mode: 0o644 };
const dir = { isDirectory: true, mode: 0o755 };

test('relative or non-string paths are refused before touching the filesystem', () => {
  assert.equal(shellPathRefusal('src/index.ts', file, 'darwin'), 'relative');
  assert.equal(shellPathRefusal('-a', file, 'linux'), 'relative');
  assert.equal(shellPathRefusal(undefined, file, 'linux'), 'relative');
  assert.equal(shellPathRefusal('/repo/src', null, 'linux'), 'missing');
  assert.equal(shellPathRefusal('C:\\repo\\run.exe', file, 'win32'), null);
  assert.equal(shellPathRefusal('/repo/run.exe', file, 'win32'), null);
});

test('plain open refuses what the OS would launch', () => {
  assert.equal(openPathRefusal('/repo/README.md', file, 'darwin'), null);
  assert.equal(openPathRefusal('/repo/src', dir, 'darwin'), null);
  assert.equal(openPathRefusal('/repo/Evil.app', dir, 'darwin'), 'launchable');
  assert.equal(openPathRefusal('/repo/run.command', file, 'darwin'), 'launchable');
  assert.equal(openPathRefusal('/repo/tool', { isDirectory: false, mode: 0o755 }, 'linux'), 'launchable');
  assert.equal(openPathRefusal('/repo/todex.desktop', file, 'linux'), 'launchable');
  assert.equal(openPathRefusal('C:\\repo\\setup.EXE', file, 'win32'), 'launchable');
  for (const name of ['tool.py', 'tool.PYW', 'help.chm', 'x.library-ms', 'q.search-ms', 'app.msix', 'app.appinstaller', 'fix.diagcab', 'addin.xll', 'dark.theme', 'x.settingcontent-ms']) {
    assert.equal(openPathRefusal(`C:\\repo\\${name}`, file, 'win32'), 'launchable', name);
  }
  // Windows-only launchers are documents elsewhere.
  assert.equal(openPathRefusal('/repo/tool.py', file, 'linux'), null);
  assert.equal(openPathRefusal('C:\\repo\\setup.exe. ', file, 'win32'), 'launchable');
  // Windows has no execute bit; the mode is ignored there.
  assert.equal(openPathRefusal('C:\\repo\\notes.txt', { isDirectory: false, mode: 0o777 }, 'win32'), null);
  assert.equal(openPathRefusal('/repo/.bashrc', file, 'linux'), null);
});

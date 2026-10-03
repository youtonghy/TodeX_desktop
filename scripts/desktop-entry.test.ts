import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDesktopEntry, isStaleTodeXEntry, pngDimensions, quoteExecArg, syncDesktopEntry } from '../src/main/desktopEntry.ts';

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test('the managed entry quotes the executable and never hides behind TryExec', () => {
  const content = buildDesktopEntry({
    exec: '/home/u/.local/bin/TodeX-v2.1.4-linux-x86_64.AppImage',
    name: 'TodeX',
    comment: 'TodeX desktop client',
    wmClass: 'TodeX',
  });
  assert.match(content, /^Exec="\/home\/u\/\.local\/bin\/TodeX-v2\.1\.4-linux-x86_64\.AppImage"$/m);
  assert.match(content, /^Name=TodeX$/m);
  assert.match(content, /^Icon=todex$/m);
  assert.match(content, /^StartupWMClass=TodeX$/m);
  assert.doesNotMatch(content, /TryExec/);
});

test('exec quoting escapes desktop entry metacharacters', () => {
  assert.equal(quoteExecArg('/a/b'), '"/a/b"');
  assert.equal(quoteExecArg('/a b/c'), '"/a b/c"');
  assert.equal(quoteExecArg('/a"b\\c$d`e'), '"/a\\"b\\\\c\\$d\\`e"');
});

test('png dimensions come from the IHDR header', () => {
  assert.deepEqual(pngDimensions(pngBytes(1024, 1024)), { width: 1024, height: 1024 });
  assert.equal(pngDimensions(new Uint8Array(8)), null);
  assert.equal(pngDimensions(new Uint8Array(32).fill(0x61)), null);
});

test('stale entries are dead TodeX release AppImages in the updater-managed directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'todex-entry-'));
  const live = join(dir, 'TodeX-v2.1.4-linux-x86_64.AppImage');
  const dead = join(dir, 'TodeX-v2.1.1-linux-x86_64.AppImage');
  writeFileSync(live, 'app');
  assert.equal(isStaleTodeXEntry(`Exec="${live}"\n`, dir), false);
  assert.equal(isStaleTodeXEntry(`Exec="${dead}" %U\n`, dir), true);
  assert.equal(isStaleTodeXEntry(`Exec=${dead}\n`, dir), true);
  assert.equal(isStaleTodeXEntry(`TryExec=${dead}\nExec=other\n`, dir), true);
  assert.equal(isStaleTodeXEntry(`Exec="${join('/other/dir', 'TodeX-v2.1.1-linux-x86_64.AppImage')}"\n`, dir), false);
  assert.equal(isStaleTodeXEntry(`Exec="${join(dir, 'Other-2.1.1.AppImage')}"\n`, dir), false);
  assert.equal(isStaleTodeXEntry(`Exec="${join(dir, 'TodeX.AppImage')}"\n`, dir), false);
});

test('sync rewrites the entry, installs the icon, and drops dead entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'todex-desktop-sync-'));
  const dataHome = join(root, 'data');
  const applicationsDir = join(dataHome, 'applications');
  const binDir = join(root, 'bin');
  mkdirSync(applicationsDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const iconSource = join(root, 'icon.png');
  writeFileSync(iconSource, pngBytes(512, 512));
  const appImage = join(binDir, 'TodeX-v2.1.1-linux-x86_64.AppImage');
  writeFileSync(appImage, 'old');

  // A leftover entry from a previous version whose AppImage the updater deleted.
  const staleEntry = join(applicationsDir, 'todex-v2.1.0-linux-x86_64.desktop');
  const deadTarget = join(binDir, 'TodeX-v2.1.0-linux-x86_64.AppImage');
  writeFileSync(staleEntry, `[Desktop Entry]\nExec="${deadTarget}" %U\nTryExec=${deadTarget}\n`);
  const unrelatedEntry = join(applicationsDir, 'other.desktop');
  writeFileSync(unrelatedEntry, `[Desktop Entry]\nExec="${join(binDir, 'Other-1.0.AppImage')}"\n`);

  const result = syncDesktopEntry({
    appImage,
    iconSource,
    name: 'TodeX',
    wmClass: 'TodeX',
    dataHome,
    refreshDatabase: false,
  });
  const entryPath = join(applicationsDir, 'todex.desktop');
  assert.equal(result.entry, entryPath);
  assert.equal(result.rewritten, true);
  assert.equal(result.icon, join(dataHome, 'icons', 'hicolor', '512x512', 'apps', 'todex.png'));
  assert.deepEqual(result.removedEntries, ['todex-v2.1.0-linux-x86_64.desktop']);
  assert.equal(existsSync(staleEntry), false);
  assert.equal(existsSync(unrelatedEntry), true);
  assert.ok(readFileSync(entryPath, 'utf8').includes(`Exec="${appImage}"`));

  // Unchanged content is not rewritten.
  const same = { name: 'TodeX', wmClass: 'TodeX', dataHome, refreshDatabase: false };
  assert.equal(syncDesktopEntry({ appImage, ...same }).rewritten, false);

  // An update swaps the file for a new versioned name; the entry follows it.
  const updated = join(binDir, 'TodeX-v2.1.4-linux-x86_64.AppImage');
  renameSync(appImage, updated);
  const after = syncDesktopEntry({ appImage: updated, ...same });
  const content = readFileSync(entryPath, 'utf8');
  assert.equal(after.rewritten, true);
  assert.ok(content.includes(`Exec="${updated}"`));
  assert.ok(!content.includes('TodeX-v2.1.1'));
});

#!/usr/bin/env node
// Desktop and web share their renderer: every file under src/renderer that
// both clients have must be byte-identical, except the platform modules
// below. Compares against the sibling checkout (../TodeX_web from desktop,
// ../TodeX_desktop from web) and skips when it is not there.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Files each client implements for itself (see src/renderer/platform/types.ts). */
const PLATFORM_FILES = new Set([
  'main.tsx',
  'demo/index.ts',
  'platform/index.ts',
  'platform/slots.tsx',
  'lib/storage.ts',
  'lib/historyKeyStore.ts',
  'lib/sshPasswordStore.ts',
  'lib/localApproval.ts',
  // Each catalog carries its own client's extra keys.
  'i18n/messages/en.ts',
  'i18n/messages/zh-CN.ts',
  'i18n/messages/ja.ts',
  'i18n/messages/ko.ts',
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
const sibling = resolve(root, '..', name === 'todex-web' ? 'TodeX_desktop' : 'TodeX_web');
const ours = join(root, 'src/renderer');
const theirs = join(sibling, 'src/renderer');

if (!existsSync(theirs)) {
  console.log(`check-shared-sync: ${relative(root, sibling) || sibling} not found, skipped`);
  process.exit(0);
}

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const drifted = files(ours)
  .map((path) => relative(ours, path).split('\\').join('/'))
  .filter((path) => !PLATFORM_FILES.has(path) && existsSync(join(theirs, path)))
  .filter((path) => !readFileSync(join(ours, path)).equals(readFileSync(join(theirs, path))));

if (drifted.length) {
  console.error(`check-shared-sync: these shared renderer files differ from ${sibling}:`);
  for (const path of drifted) console.error(`  src/renderer/${path}`);
  console.error('Apply the change to both clients (platform differences belong in src/renderer/platform/).');
  process.exit(1);
}
console.log('check-shared-sync: shared renderer files match');

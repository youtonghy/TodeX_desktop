import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

// Static IPC contract between src/preload and src/main: every channel one
// side uses must exist on the other with the matching direction, so renaming
// or dropping a handler fails here instead of as a silent runtime no-op.

const root = resolve(import.meta.dirname, '..');

function sources(dir: string): string {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

/** Channels passed as the first argument to `callee`; a leading `.` matches
 * any receiver (`window.webContents.send`, `sender.send`). */
function channels(source: string, callee: string): Set<string> {
  const name = callee.startsWith('.') ? callee.replace('.', '\\.') : `(?<![\\w.])${callee.replace('.', '\\.')}`;
  const pattern = new RegExp(`${name}(?:<[^>]*>)?\\(\\s*'([\\w-]+:[\\w-]+)'`, 'g');
  return new Set(Array.from(source.matchAll(pattern), (match) => match[1]));
}

function union(...sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((set) => [...set]));
}

const preload = sources('src/preload');
const main = sources('src/main');

const preloadInvokes = union(channels(preload, 'invoke'), channels(preload, 'ipcRenderer.invoke'));
const preloadSends = channels(preload, 'ipcRenderer.send');
const preloadListens = channels(preload, 'ipcRenderer.on');
// `handle(...)` is the registrar that container/localBackend receive from handleIpc.
const mainHandles = union(channels(main, 'handleIpc'), channels(main, 'handle'), channels(main, 'ipcMain.handle'));
const mainListens = channels(main, 'ipcMain.on');
// Bare `send(...)` covers local wrappers such as container setup's.
const mainSends = union(channels(main, '.send'), channels(main, 'send'));

function missing(used: Set<string>, available: Set<string>): string[] {
  return [...used].filter((channel) => !available.has(channel)).sort();
}

test('the extraction finds both sides of the bridge', () => {
  for (const [name, set] of Object.entries({ preloadInvokes, preloadSends, preloadListens, mainHandles, mainListens, mainSends })) {
    assert.ok(set.size > 0, `${name} found no channels; the patterns no longer match the source`);
  }
});

test('every preload invoke has a main handler, and every handler is invoked', () => {
  assert.deepEqual(missing(preloadInvokes, mainHandles), [], 'invoked from preload without an ipcMain.handle');
  assert.deepEqual(missing(mainHandles, preloadInvokes), [], 'handled in main but never invoked from preload');
});

test('every preload send has a main listener, and every listener is sent to', () => {
  assert.deepEqual(missing(preloadSends, mainListens), [], 'sent from preload without an ipcMain.on');
  assert.deepEqual(missing(mainListens, preloadSends), [], 'listened to in main but never sent from preload');
});

test('every event main pushes is subscribed in preload, and every subscription is pushed', () => {
  assert.deepEqual(missing(mainSends, preloadListens), [], 'sent from main without an ipcRenderer.on');
  assert.deepEqual(missing(preloadListens, mainSends), [], 'subscribed in preload but never sent from main');
});

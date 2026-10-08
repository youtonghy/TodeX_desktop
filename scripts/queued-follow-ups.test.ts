import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateLegacyFollowUps, restoreQueuedFollowUps, type LegacyQueueTarget } from '../src/renderer/session/queuedFollowUps.ts';

const item = (id: string) => ({ id, text: id, attachments: [], skills: [] });

async function migrate(stored: unknown, resolve: (id: string) => LegacyQueueTarget, failing = new Set<string>(), readOnly = new Set<string>()) {
  const log: string[] = [];
  await migrateLegacyFollowUps(restoreQueuedFollowUps<ReturnType<typeof item>>(stored), {
    resolve,
    add: async (_id, next, paused) => {
      log.push(`add ${next.id}${paused ? ' paused' : ''}`);
      return failing.has(next.id) ? 'failed' : readOnly.has(next.id) ? 'gone' : 'added';
    },
    settle: (id, discarded) => log.push(`settle ${id}${discarded.length ? ` discarded ${discarded.map((entry) => entry.id)}` : ''}`),
  });
  return log;
}

test('restores the v1 map and the v2 shape, ignoring junk', () => {
  assert.deepEqual(restoreQueuedFollowUps({ a: [item('x'), { id: 1 }] }), { queues: { a: [item('x')] }, paused: [] });
  assert.deepEqual(restoreQueuedFollowUps({ version: 2, queues: { a: [item('x')] }, paused: ['a', 'gone', 7] }),
    { queues: { a: [item('x')] }, paused: ['a'] });
  assert.deepEqual(restoreQueuedFollowUps('junk'), { queues: {}, paused: [] });
});

test('adds in order under the original ids and settles after the last add', async () => {
  const log = await migrate({ a: [item('a1'), item('a2')] }, () => ({ kind: 'ready', control: false }));
  assert.deepEqual(log, ['add a1', 'add a2', 'settle a']);
});

test('a paused conversation adds its first item paused, or waits without pause control', async () => {
  const stored = { version: 2, queues: { a: [item('a1'), item('a2')] }, paused: ['a'] };
  assert.deepEqual(await migrate(stored, () => ({ kind: 'ready', control: true })), ['add a1 paused', 'add a2', 'settle a']);
  assert.deepEqual(await migrate(stored, () => ({ kind: 'ready', control: false })), []);
});

test('undecidable conversations stay, gone and read-only ones are discarded with their text', async () => {
  const stored = { a: [item('a1')], b: [item('b1')], c: [item('c1')] };
  const log = await migrate(stored, (id) => id === 'a' ? { kind: 'wait' } : id === 'b' ? { kind: 'gone' } : { kind: 'ready', control: true },
    new Set(), new Set(['c1']));
  assert.deepEqual(log, ['settle b discarded b1', 'add c1', 'settle c discarded c1']);
});

test('a transient failure keeps the local copy for the next connection', async () => {
  const log = await migrate({ a: [item('a1'), item('a2')], b: [item('b1')] }, () => ({ kind: 'ready', control: true }), new Set(['a2']));
  assert.deepEqual(log, ['add a1', 'add a2', 'add b1', 'settle b']);
});

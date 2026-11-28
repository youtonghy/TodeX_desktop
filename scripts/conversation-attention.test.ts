import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationAttention } from '../src/renderer/session/conversationAttention.ts';

const idle = { nativeStatus: 'idle', updatedAt: 100, lastCompletedAt: 100, lastReadAt: 50 };
const failed = { ...idle, nativeStatus: 'failed' };
const reply = { at: 100, kind: 'incoming' as const, title: 'done' };

test('without shared read positions this device\'s read time decides', () => {
  assert.equal(conversationAttention(idle, reply, 100), 'unread');
  assert.equal(conversationAttention({ ...idle, lastReadAt: 200 }, reply, 100), null);
  assert.equal(conversationAttention(failed, undefined, undefined), 'issue');
});

test('a shared read position overrides this device\'s read time', () => {
  // Seen on another device: nothing waits here, though this device never looked.
  assert.equal(conversationAttention(idle, reply, 100, false), null);
  assert.equal(conversationAttention(failed, undefined, undefined, false), null);
  // Unseen anywhere: waits here even when this device looked earlier.
  assert.equal(conversationAttention({ ...idle, lastReadAt: 500 }, reply, 100, true), 'unread');
  assert.equal(conversationAttention(failed, undefined, undefined, true), 'issue');
  assert.equal(conversationAttention(idle, { at: 1, kind: 'incoming', title: 'x', marker: 'error' }, 1, true), 'issue');
});

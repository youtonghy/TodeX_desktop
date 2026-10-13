import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONVERSATION_WARM_INTERVAL_MS,
  isConversationWarmRequestId,
  shouldWarmConversation,
} from '../src/renderer/session/conversationWarm.ts';

test('warms a conversation at most once per interval and never while busy', () => {
  const sent = new Map([['c1', 1_000]]);
  assert.equal(shouldWarmConversation('c2', 1_000, sent, false), true);
  assert.equal(shouldWarmConversation('c1', 1_000 + CONVERSATION_WARM_INTERVAL_MS - 1, sent, false), false);
  assert.equal(shouldWarmConversation('c1', 1_000 + CONVERSATION_WARM_INTERVAL_MS, sent, false), true);
  assert.equal(shouldWarmConversation('c2', 1_000, sent, true), false);
  assert.equal(shouldWarmConversation('', 1_000, sent, false), false);
});

test('recognizes warm request ids only', () => {
  assert.equal(isConversationWarmRequestId('warm-abc-123'), true);
  assert.equal(isConversationWarmRequestId('watchdog-abc-123'), false);
  assert.equal(isConversationWarmRequestId(undefined), false);
});

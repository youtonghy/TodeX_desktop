import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchConversations } from '../src/renderer/session/conversationSearch.ts';

const conversations = [
  { id: 'a', workspaceId: 'w1', title: 'Fix login bug' },
  { id: 'b', workspaceId: 'w2', title: 'Login page redesign' },
  { id: 'c', workspaceId: 'w2', title: 'Old login', archived: true },
  { id: 'd', workspaceId: 'w1', title: 'login child', parentConversationId: 'a' },
  { id: 'e', workspaceId: 'w3', title: 'login in a missing directory' },
  { id: 'f', workspaceId: 'w3', title: 'Unrelated' },
];
const titleOf = (conversation: { title: string }) => conversation.title;

test('search spans every workspace and ignores case', () => {
  assert.deepEqual(searchConversations(conversations, '  LOGIN ', titleOf).map((item) => item.id), ['a', 'b', 'e']);
});

test('archived, child and hidden-workspace conversations are left out', () => {
  assert.deepEqual(searchConversations(conversations, 'login', titleOf, new Set(['w3'])).map((item) => item.id), ['a', 'b']);
});

test('an empty query matches nothing', () => {
  assert.deepEqual(searchConversations(conversations, '   ', titleOf), []);
});

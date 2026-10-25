import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchConversations, searchSnippet } from '../src/renderer/session/conversationSearch.ts';

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
  assert.deepEqual(searchConversations(conversations, '  LOGIN ', titleOf).map((hit) => hit.conversation.id), ['a', 'b', 'e']);
});

test('archived, child and hidden-workspace conversations are left out', () => {
  assert.deepEqual(searchConversations(conversations, 'login', titleOf, new Set(['w3'])).map((hit) => hit.conversation.id), ['a', 'b']);
});

test('an empty query matches nothing', () => {
  assert.deepEqual(searchConversations(conversations, '   ', titleOf), []);
});

test('content matches follow title matches and carry a snippet', () => {
  const texts: Record<string, string[]> = { f: ['The login\nform crashes on submit'], c: ['login'] };
  const hits = searchConversations(conversations, 'LOGIN', titleOf, new Set(), (conversation) => texts[conversation.id] ?? []);
  assert.deepEqual(hits.map((hit) => [hit.conversation.id, hit.snippet]), [
    ['a', undefined], ['b', undefined], ['e', undefined], ['f', 'The login form crashes on submit'],
  ]);
});

test('a snippet is cut around the match', () => {
  const text = `${'x'.repeat(40)} needle ${'y'.repeat(100)}`;
  const snippet = searchSnippet(text, 'needle') ?? '';
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
  assert.ok(snippet.includes('needle'));
  assert.equal(searchSnippet('nothing here', 'needle'), undefined);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GIT_LOG_FIRST_READ, nextCommitReveal, shouldPrefetchCommits } from '../src/renderer/session/gitLogPaging.ts';

test('the first read keeps one page ahead of the latest commit', () => {
  assert.equal(GIT_LOG_FIRST_READ, 6);
  assert.deepEqual(nextCommitReveal(6, 1, true), { count: 5 });
  assert.equal(shouldPrefetchCommits(6, 1, true), false);
});

test('a short history names exactly what is left', () => {
  assert.deepEqual(nextCommitReveal(3, 1, false), { count: 2 });
  assert.equal(nextCommitReveal(3, 3, false), null);
  assert.equal(nextCommitReveal(1, 1, false), null);
  assert.equal(shouldPrefetchCommits(3, 3, false), false);
});

test('after an expand the next page is fetched before a count is shown', () => {
  assert.equal(shouldPrefetchCommits(6, 6, true), true);
  assert.deepEqual(nextCommitReveal(6, 6, true), {});
  assert.deepEqual(nextCommitReveal(11, 6, true), { count: 5 });
  assert.equal(shouldPrefetchCommits(11, 6, true), false);
});

test('a shown count past the loaded items is clamped', () => {
  assert.deepEqual(nextCommitReveal(8, 11, false), null);
  assert.deepEqual(nextCommitReveal(8, 11, true), {});
});

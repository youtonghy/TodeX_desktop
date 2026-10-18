import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGitDiffPathRequired } from '../src/renderer/lib/gitErrors.ts';

test('an old backend rejecting the whole-repo diff is recognised', () => {
  // Axum query rejection: plain text body, so no code and a generic message.
  assert.equal(isGitDiffPathRequired({ status: 400 }), true);
  assert.equal(isGitDiffPathRequired({ status: 400, code: 'INVALID_REQUEST', message: 'path is required' }), true);
  assert.equal(isGitDiffPathRequired({ status: 422, message: 'Failed to deserialize query string: missing field `path`' }), true);
});

test('other diff failures are not mistaken for an old backend', () => {
  assert.equal(isGitDiffPathRequired({ status: 404, code: 'NOT_FOUND' }), false);
  assert.equal(isGitDiffPathRequired({ status: 400, code: 'WORKSPACE_PATH_NOT_FOUND', message: 'no such path' }), false);
  assert.equal(isGitDiffPathRequired({ status: 400, code: 'INVALID_REQUEST', message: 'workspace is not a repository' }), false);
  assert.equal(isGitDiffPathRequired({ status: 500 }), false);
  assert.equal(isGitDiffPathRequired({}), false);
});

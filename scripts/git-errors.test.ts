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

test('a git command failure is a plain failure, a partial success stays uncertain', async () => {
  const { isUncertainGitOutcome } = await import('../src/renderer/lib/gitErrors.ts');
  assert.equal(isUncertainGitOutcome({ status: 409, code: 'GIT_COMMAND_FAILED' }), false);
  assert.equal(isUncertainGitOutcome({ status: 500, code: 'GIT_COMMAND_FAILED' }), false);
  assert.equal(isUncertainGitOutcome({ status: 409, code: 'GIT_PARTIAL_SUCCESS' }), true);
  assert.equal(isUncertainGitOutcome({ status: 504, code: 'GIT_COMMAND_TIMED_OUT' }), true);
  assert.equal(isUncertainGitOutcome({ status: 502 }), true);
  assert.equal(isUncertainGitOutcome({ status: 400, code: 'INVALID_REQUEST' }), false);
  assert.equal(isUncertainGitOutcome({ status: 400, code: 'GIT_COMMAND_FAILED', unknownOutcome: true }), true);
});

test('empty and legacy placeholder outputs map to the UI done text', async () => {
  const { gitOperationOutput } = await import('../src/renderer/lib/gitErrors.ts');
  assert.equal(gitOperationOutput(''), '');
  assert.equal(gitOperationOutput(undefined), '');
  assert.equal(gitOperationOutput('Operation completed'), '');
  assert.equal(gitOperationOutput('Operation completed\n'), '');
  assert.equal(gitOperationOutput('Switched to branch main'), 'Switched to branch main');
});

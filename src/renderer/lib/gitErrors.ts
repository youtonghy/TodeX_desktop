// Pure classification of Git endpoint failures, kept free of i18n and
// transport imports so it can be unit tested directly.

export type GitFailure = { status?: number; code?: string; message?: string };

/** Whether a whole-repo `GET /v2/git/diff` (no `path`) was rejected by a
 * backend that predates it: older backends require `path` and answer its
 * absence with a 400/422 validation error. */
export function isGitDiffPathRequired(failure: GitFailure): boolean {
  if (failure.status !== 400 && failure.status !== 422) return false;
  const code = failure.code ?? '';
  if (code && code !== 'INVALID_REQUEST' && code !== 'VALIDATION_ERROR' && code !== 'BAD_REQUEST') return false;
  // Axum's query rejection (`missing field \`path\``) or a validation message
  // naming the parameter; a bare status from a non-JSON body counts too.
  const message = failure.message ?? '';
  return !code || !message || /\bpath\b/i.test(message);
}

const UNCERTAIN_CODES = new Set(['GIT_PARTIAL_SUCCESS', 'GIT_COMMAND_TIMED_OUT', 'GIT_COMMAND_TIMEOUT', 'GIT_OUTCOME_UNKNOWN']);

/** Whether a failed Git write may still have changed the repository (so the
 * UI warns and blocks further writes until the state is re-read).
 * `GIT_COMMAND_FAILED` certainly changed nothing and is a plain failure;
 * partial successes, timeouts and uncoded server errors are uncertain. */
export function isUncertainGitOutcome(failure: GitFailure & { unknownOutcome?: boolean }): boolean {
  if (failure.unknownOutcome === true) return true;
  if (failure.code === 'GIT_COMMAND_FAILED') return false;
  if (failure.code && UNCERTAIN_CODES.has(failure.code)) return true;
  return (failure.status ?? 0) >= 500;
}

/** Older backends answer a Git write without output with this placeholder. */
const LEGACY_DONE_OUTPUT = 'Operation completed';

/** A Git write's output to show; empty (the UI's own "done" text) when the
 * backend sent none or the legacy placeholder. */
export function gitOperationOutput(output: string | null | undefined): string {
  const text = output ?? '';
  return text.trim() === LEGACY_DONE_OUTPUT ? '' : text;
}

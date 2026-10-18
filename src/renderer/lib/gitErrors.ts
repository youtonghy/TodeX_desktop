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

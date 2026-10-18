// Paging of the Git status tab's commit history. Pure so it can be unit
// tested: the button names exactly what it reveals, which needs one page
// loaded ahead of what is shown.

/** The status tab shows the latest commit first and reveals this many more per expand. */
export const GIT_LOG_PAGE_SIZE = 5;

/** The first read: the latest commit plus the page the first expand shows. */
export const GIT_LOG_FIRST_READ = 1 + GIT_LOG_PAGE_SIZE;

/** What the next expand reveals: `{ count }` when that many are already
 * loaded, `{}` when more exist but are not loaded yet (count unknown),
 * `null` when there is nothing more. */
export function nextCommitReveal(loaded: number, shown: number, hasMore: boolean, pageSize = GIT_LOG_PAGE_SIZE): { count?: number } | null {
  const remaining = loaded - Math.min(shown, loaded);
  if (remaining > 0) return { count: Math.min(pageSize, remaining) };
  return hasMore ? {} : null;
}

/** Whether another page should be fetched so a full page stays loaded
 * beyond what is shown. */
export function shouldPrefetchCommits(loaded: number, shown: number, hasMore: boolean, pageSize = GIT_LOG_PAGE_SIZE): boolean {
  return hasMore && loaded < Math.min(shown, loaded) + pageSize;
}

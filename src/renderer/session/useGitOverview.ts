import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionSettings } from '@todex/protocol/todex';
import {
  GitWorkspaceError, readGitLog, readGitPullRequest, readGitStatus, readGitWorkspace,
  type GitLogCommit, type GitPullRequestSnapshot, type GitStatusSummary, type GitWorkspaceSnapshot,
} from '../lib/gitWorkspace';
import { t } from '../i18n';

/** The status tab shows the latest commit first and reveals this many more per expand. */
export const GIT_LOG_PAGE_SIZE = 5;
/**
 * The backend admits two concurrent Git reads and answers 409 once a request
 * has queued for two seconds; scans and PR lookups can hold a slot for longer.
 */
const BUSY_RETRY_DELAYS_MS = [500, 1_500, 3_000];

export type GitOverviewSection<T> = { data: T | null; error: string; loading: boolean };
/** `unsupported`: the backend predates GET /v2/git/log (404), so there is no history to show. */
export type GitOverviewCommits = { items: GitLogCommit[]; hasMore: boolean; error: string; loading: boolean; unsupported: boolean };

const idle = { data: null, error: '', loading: false };
const idleCommits: GitOverviewCommits = { items: [], hasMore: false, error: '', loading: false, unsupported: false };

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, { once: true });
  });
}

async function retryWhenBusy<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (cause) {
      const delay = BUSY_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || signal.aborted || !(cause instanceof GitWorkspaceError && cause.status === 409)) throw cause;
      await sleep(delay, signal);
      if (signal.aborted) throw cause;
    }
  }
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : t('git.readFailed');
}

/**
 * Read-only data for the Git menu's status tab. Requests run one after another
 * (status, history, branches/worktrees, then the PR, which may wait on GitHub)
 * so opening the menu never takes both backend read slots at once.
 */
export function useGitOverview({ settings, repoPath, enabled }: {
  settings: ConnectionSettings;
  repoPath: string;
  enabled: boolean;
}) {
  const identity = JSON.stringify([settings.serverUrl, settings.deviceSecret, repoPath]);
  const [status, setStatus] = useState<GitOverviewSection<GitStatusSummary>>(idle);
  const [workspace, setWorkspace] = useState<GitOverviewSection<GitWorkspaceSnapshot>>(idle);
  const [pullRequest, setPullRequest] = useState<GitOverviewSection<GitPullRequestSnapshot>>(idle);
  const [commits, setCommits] = useState<GitOverviewCommits>(idleCommits);
  const controllerRef = useRef<AbortController | null>(null);
  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const loadedIdentity = useRef('');

  useEffect(() => {
    if (!enabled || !repoPath) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    if (loadedIdentity.current !== identity) {
      // A different repository or backend: never show the previous one's data.
      loadedIdentity.current = identity;
      setStatus(idle); setWorkspace(idle); setPullRequest(idle); setCommits(idleCommits);
    }
    const step = async <T>(read: () => Promise<T>, apply: (result: { data: T } | { error: string; status?: number }) => void) => {
      if (signal.aborted) return null;
      try {
        const data = await retryWhenBusy(read, signal);
        if (!signal.aborted) apply({ data });
        return data;
      } catch (cause) {
        if (!signal.aborted) apply({ error: message(cause), status: cause instanceof GitWorkspaceError ? cause.status : undefined });
        return null;
      }
    };
    void (async () => {
      setStatus(current => ({ ...current, loading: true }));
      const summary = await step(() => readGitStatus(settings, repoPath, signal),
        result => setStatus('data' in result ? { data: result.data, error: '', loading: false } : { data: null, error: result.error, loading: false }));
      if (!summary?.initialized) {
        if (!signal.aborted) { setWorkspace(idle); setPullRequest(idle); setCommits(idleCommits); }
        return;
      }
      setCommits(current => ({ ...current, loading: true }));
      await step(() => readGitLog(settings, repoPath, 0, 1, signal),
        result => setCommits('data' in result
          ? { items: result.data.commits, hasMore: result.data.hasMore, error: '', loading: false, unsupported: false }
          : result.status === 404
            ? { ...idleCommits, unsupported: true }
            : { items: [], hasMore: false, error: result.error, loading: false, unsupported: false }));
      setWorkspace(current => ({ ...current, loading: true }));
      await step(() => readGitWorkspace(settings, repoPath, signal),
        result => setWorkspace('data' in result ? { data: result.data, error: '', loading: false } : { data: null, error: result.error, loading: false }));
      setPullRequest(current => ({ ...current, loading: true }));
      await step(() => readGitPullRequest(settings, repoPath, signal),
        result => setPullRequest('data' in result ? { data: result.data, error: '', loading: false } : { data: null, error: result.error, loading: false }));
    })();
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [identity, enabled, repoPath, settings]);

  /** Loads the next page of older commits; resolves once it has been applied. */
  const loadMoreCommits = useCallback(async () => {
    const controller = controllerRef.current;
    const current = commitsRef.current;
    if (!controller || current.loading || !current.hasMore) return;
    const { signal } = controller;
    setCommits({ ...current, loading: true, error: '' });
    try {
      const page = await retryWhenBusy(() => readGitLog(settings, repoPath, current.items.length, GIT_LOG_PAGE_SIZE, signal), signal);
      if (signal.aborted) return;
      setCommits(latest => ({ ...latest, items: [...latest.items, ...page.commits], hasMore: page.hasMore, error: '', loading: false }));
    } catch (cause) {
      if (!signal.aborted) setCommits(latest => ({ ...latest, loading: false, error: message(cause) }));
    }
  }, [settings, repoPath]);

  return { status, workspace, pullRequest, commits, loadMoreCommits };
}

export type GitOverview = ReturnType<typeof useGitOverview>;

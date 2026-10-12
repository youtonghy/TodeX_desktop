import { RiGitBranchLine, RiStackLine } from '@remixicon/react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Spinner } from '@/components/ui/spinner';
import { cx } from '@/utils/cx';
import { ShortcutHint } from '../lib/shortcuts';
import { filesWorkspaceForConversation } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import { useGitStatus } from '../session/useGitStatus';
import { useGitRepositories } from '../session/useGitRepositories';
import type { GitRepositoryItem, GitStatusSummary } from '../lib/gitWorkspace';
import { useT } from '../i18n';

type Props = { session: TodeXSession; gitOpen: boolean; onOpenGit: () => void };

export type GitRepoOption = {
  path: string;
  name: string;
  branch: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  containing: boolean;
  uninitialized: boolean;
  error?: string;
};

// The backend scan inserts an UNINITIALIZED pseudo-entry for the workspace path
// when the workspace directory itself is not a repository root.
function isUninitializedEntry(repo: GitRepositoryItem, workspacePath: string) {
  return repo.path === workspacePath && repo.initialEligible && repo.branch === 'UNINITIALIZED';
}

function repoName(path: string) {
  return path.split(/[/\\]/).filter(Boolean).pop() || path;
}

function hasChanges(repo: GitRepositoryItem) {
  return !repo.error && (repo.files.length > 0 || repo.additions > 0 || repo.deletions > 0);
}

export function useConversationGitStatus(session: TodeXSession, gitOpen: boolean, enabled = true) {
  const conversation = session.activeConversation;
  const workspace = filesWorkspaceForConversation(session.workspaces.find(item => item.id === conversation?.workspaceId), conversation);
  const connected = enabled && session.connectionState === 'open' && Boolean(workspace?.path)
    && (!workspace?.backendConnectionId || workspace.backendConnectionId === session.activeBackendConnectionId);
  const workspacePath = workspace?.path || '';
  const thinking = Boolean(conversation && session.thinkingConversations[conversation.id]);
  const scopeKey = `${session.activeBackendConnectionId}:${conversation?.id || ''}`;
  const status = useGitStatus({
    settings: session.settings, workspacePath, scopeKey,
    enabled: connected, thinking, refreshKey: gitOpen,
  });
  const scan = useGitRepositories({
    settings: session.settings, workspacePath, scopeKey,
    enabled: connected, thinking, refreshKey: gitOpen,
  });

  const containingRepo = status.data?.initialized ? status.data.repositoryPath : '';
  const repositories = scan.repositories;
  const pseudo = (repositories ?? []).find(repo => isUninitializedEntry(repo, workspacePath));
  const realRepos = (repositories ?? []).filter(repo => !isUninitializedEntry(repo, workspacePath));
  const dirtyRepos = realRepos.filter(hasChanges);

  const stored = workspace ? session.selectedGitRepoByWorkspace[workspace.id] : undefined;
  const knownPaths = new Set([workspacePath, containingRepo, ...realRepos.map(repo => repo.path)].filter(Boolean));
  const storedValid = Boolean(stored) && (repositories === null || knownPaths.has(stored as string));
  const selectedPath = (storedValid ? stored : undefined)
    ?? containingRepo
    ?? dirtyRepos[0]?.path
    ?? realRepos[0]?.path
    ?? workspacePath;

  const repoOptions: GitRepoOption[] = realRepos.map(repo => ({
    path: repo.path,
    name: repo.name,
    branch: repo.branch === 'UNKNOWN' ? '' : repo.branch,
    changedFiles: repo.files.length,
    additions: repo.additions,
    deletions: repo.deletions,
    containing: repo.path === containingRepo,
    uninitialized: false,
    error: repo.error,
  }));
  if (containingRepo && !repoOptions.some(option => option.path === containingRepo)) {
    repoOptions.unshift({
      path: containingRepo,
      name: repoName(containingRepo),
      branch: status.data?.branch || '',
      changedFiles: status.data?.changedFiles ?? 0,
      additions: status.data?.additions ?? 0,
      deletions: status.data?.deletions ?? 0,
      containing: true,
      uninitialized: false,
    });
  }
  if (pseudo && !containingRepo) {
    repoOptions.push({
      path: workspacePath,
      name: workspace?.name || repoName(workspacePath),
      branch: '',
      changedFiles: 0,
      additions: 0,
      deletions: 0,
      containing: false,
      uninitialized: true,
    });
  }
  repoOptions.sort((a, b) => Number(b.changedFiles > 0) - Number(a.changedFiles > 0) || a.path.localeCompare(b.path));

  const selectedSummary = realRepos.find(repo => repo.path === selectedPath);
  let data: GitStatusSummary | null = status.data;
  let error = status.error;
  if (selectedSummary && selectedPath !== containingRepo) {
    data = selectedSummary.error ? null : {
      repositoryPath: selectedSummary.path,
      initialized: true,
      branch: selectedSummary.branch === 'UNKNOWN' ? null : selectedSummary.branch,
      worktreeKind: null,
      changedFiles: selectedSummary.files.length,
      additions: selectedSummary.additions,
      deletions: selectedSummary.deletions,
      statsTruncated: Boolean(selectedSummary.filesTruncated),
    };
    error = selectedSummary.error || '';
  }

  const selectRepo = (path: string) => {
    if (workspace) session.selectGitRepo(workspace.id, path);
  };
  const refresh = () => { status.refresh(); scan.refresh(); };
  // Per-file changes only come from the scan; empty until it covers the repo.
  const files = selectedSummary && !selectedSummary.error ? selectedSummary.files : [];
  return {
    workspace, connected, data, error,
    loading: status.loading && !data,
    refresh, repoOptions, dirtyRepos, selectedPath, containingRepo, selectRepo,
    files, filesTruncated: Boolean(selectedSummary?.filesTruncated),
  };
}

export function GitStatusIndicator({ session, gitOpen, onOpenGit }: Props) {
  const state = useConversationGitStatus(session, gitOpen);
  return <GitStatusDisplay state={state} onOpenGit={onOpenGit} />;
}

export function GitStatusDisplay({ state, onOpenGit, wrap = true }: { state: ReturnType<typeof useConversationGitStatus>; onOpenGit: () => void; wrap?: boolean }) {
  const t = useT();
  const { workspace, connected, data, error, loading, refresh, repoOptions, dirtyRepos } = state;
  if (!workspace?.path) return null;
  const multiRepo = repoOptions.length > 1;
  const selectedName = data?.repositoryPath ? repoName(data.repositoryPath) : '';
  const branch = data?.branch || t('git.detachedHead');
  const worktree = data?.worktreeKind === 'linked' ? t('git.linkedWorktree') : t('git.mainWorktree');
  const truncated = data?.statsTruncated ? t('git.partialStats') : '';
  const summary = data?.initialized
    ? data.worktreeKind
      ? t('git.statusSummary', { branch, worktree, count: data.changedFiles, additions: data.additions, deletions: data.deletions, truncated })
      : t('git.statusSummaryRepo', { branch, count: data.changedFiles, additions: data.additions, deletions: data.deletions, truncated })
    : !connected ? t('git.notConnected') : error ? t('git.statusUnavailable') : loading ? t('git.reading') : t('git.notInitialized');
  return <div className="relative min-w-0" data-testid="git-status">
    <ShortcutHint id="gitActions" className="absolute -top-1.5 -end-1.5 z-10" />
    <TooltipTrigger delay={300}>
      <Focusable>
        <button
          type="button"
          className={cx(
            'flex min-h-8 min-w-0 max-w-full cursor-pointer items-center justify-start gap-2 rounded-lg px-2 py-1 text-start text-caption-1-regular text-text-primary',
            'outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover active:bg-background-tertiary-default',
            'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
          )}
          aria-label={summary}
          onClick={error ? refresh : onOpenGit}
        >
          {loading ? <Spinner size="xs" /> : <RiGitBranchLine className="size-3.5 shrink-0 text-foreground-icon-secondary" />}
          {data?.initialized ? <span className={cx('flex min-w-0 items-center gap-x-3 gap-y-1', wrap ? 'flex-wrap' : 'flex-nowrap whitespace-nowrap')}>
            {multiRepo ? <span className="max-w-28 shrink-0 truncate text-text-secondary">{selectedName}</span> : null}
            <span className="max-w-40 truncate text-caption-1-medium">{branch}</span>
            {data.worktreeKind ? <span className="flex shrink-0 items-center gap-1 text-text-secondary"><RiStackLine className="size-3.5 text-foreground-icon-secondary" />{worktree}</span> : null}
            <span className="flex shrink-0 items-center gap-2 tabular-nums">
              <span className="text-text-secondary">{t('git.changedFiles', { count: data.changedFiles })}</span>
              <span className="text-status-lime-text">+{data.additions}{data.statsTruncated ? '…' : ''}</span>
              <span className="text-text-error-primary">−{data.deletions}{data.statsTruncated ? '…' : ''}</span>
              {dirtyRepos.length > 1 ? <span className="text-text-secondary">+{dirtyRepos.length - 1}</span> : null}
            </span>
          </span> : <span className={error ? 'text-status-yellow-text' : 'text-text-secondary'}>{multiRepo && selectedName ? `${selectedName} · ` : ''}{summary}</span>}
        </button>
      </Focusable>
      <Tooltip placement="bottom" className="max-w-sm space-y-1">
        <p className="break-all">{data?.repositoryPath || workspace.path}</p>
        <p>{summary}</p>
        {multiRepo && dirtyRepos.length > 0 ? <div className="space-y-0.5">
          <p className="text-text-secondary">{t('git.reposWithChanges', { count: dirtyRepos.length })}</p>
          {dirtyRepos.slice(0, 8).map(repo => <p key={repo.path} className="break-all">
            {repo.name} · {t('git.changedFiles', { count: repo.files.length })} <span className="text-status-lime-text">+{repo.additions}</span> <span className="text-text-error-primary">−{repo.deletions}</span>
          </p>)}
        </div> : null}
        {error ? <p className="break-all">{error}</p> : data?.initialized ? <p className="text-text-secondary">{t('git.statusTooltipHint')}</p> : null}
      </Tooltip>
    </TooltipTrigger>
  </div>;
}

import { filesWorkspaceForConversation } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import { useGitStatus } from '../session/useGitStatus';
import { useGitRepositories } from '../session/useGitRepositories';
import type { GitRepositoryItem, GitStatusSummary } from '../lib/gitWorkspace';

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

export function repoName(path: string) {
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

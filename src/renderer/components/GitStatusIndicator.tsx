import { RiGitBranchLine, RiStackLine } from '@remixicon/react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Spinner } from '@/components/ui/spinner';
import { cx } from '@/utils/cx';
import { ShortcutHint } from './ShortcutHint';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { repoName, useConversationGitStatus } from './useConversationGitStatus';

type Props = { session: TodeXSession; gitOpen: boolean; onOpenGit: () => void };

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

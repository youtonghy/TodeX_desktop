import { Button, Spinner, Tooltip } from '@heroui/react';
import { RiGitBranchLine, RiStackLine } from '@remixicon/react';
import type { TodeXSession } from '../session/useTodeXSession';
import { useGitStatus } from '../session/useGitStatus';

type Props = { session: TodeXSession; gitOpen: boolean; onOpenGit: () => void };

export function useConversationGitStatus(session: TodeXSession, gitOpen: boolean) {
  const conversation = session.activeConversation;
  const workspace = session.workspaces.find(item => item.id === conversation?.workspaceId);
  const connected = session.connectionState === 'open' && Boolean(workspace?.path)
    && (!workspace?.backendConnectionId || workspace.backendConnectionId === session.activeBackendConnectionId);
  const { data, error, loading, refresh } = useGitStatus({
    settings: session.settings, workspacePath: workspace?.path || '',
    scopeKey: `${session.activeBackendConnectionId}:${conversation?.id || ''}`,
    enabled: connected, thinking: Boolean(conversation && session.thinkingConversations[conversation.id]), refreshKey: gitOpen,
  });
  return { workspace, connected, data, error, loading, refresh };
}

export function GitStatusIndicator({ session, gitOpen, onOpenGit }: Props) {
  const state = useConversationGitStatus(session, gitOpen);
  return <GitStatusDisplay state={state} onOpenGit={onOpenGit} />;
}

export function GitStatusDisplay({ state, onOpenGit, wrap = true }: { state: ReturnType<typeof useConversationGitStatus>; onOpenGit: () => void; wrap?: boolean }) {
  const { workspace, connected, data, error, loading, refresh } = state;
  if (!workspace?.path) return null;
  const branch = data?.branch || '分离 HEAD';
  const worktree = data?.worktreeKind === 'linked' ? '关联工作树' : '主工作树';
  const summary = data?.initialized
    ? `${branch}，${worktree}，${data.changedFiles} 个变更文件，新增 ${data.additions} 行，删除 ${data.deletions} 行${data.statsTruncated ? '，统计为部分结果' : ''}`
    : !connected ? 'Git 未连接' : error ? 'Git 状态不可用，点击重试' : loading ? '正在读取 Git 状态' : '未初始化 Git';
  return <div className="min-w-0" data-testid="git-status">
    <Tooltip delay={300}>
      <Button size="sm" variant="ghost" className="h-auto min-h-8 min-w-0 max-w-full justify-start gap-2 px-2 py-1 text-xs font-normal"
        aria-label={summary} onPress={error ? refresh : onOpenGit}>
        {loading ? <Spinner size="sm" /> : <RiGitBranchLine className="size-3.5 shrink-0 text-muted" />}
        {data?.initialized ? <span className={`flex min-w-0 items-center gap-x-3 gap-y-1 ${wrap ? 'flex-wrap' : 'flex-nowrap whitespace-nowrap'}`}>
          <span className="max-w-40 truncate font-medium">{branch}</span>
          <span className="flex shrink-0 items-center gap-1 text-muted"><RiStackLine className="size-3.5" />{worktree}</span>
          <span className="flex shrink-0 items-center gap-2 tabular-nums">
            <span className="text-muted">{data.changedFiles} 个文件</span>
            <span className="text-success">+{data.additions}{data.statsTruncated ? '…' : ''}</span>
            <span className="text-danger">−{data.deletions}{data.statsTruncated ? '…' : ''}</span>
          </span>
        </span> : <span className={error ? 'text-warning' : 'text-muted'}>{summary}</span>}
      </Button>
      <Tooltip.Content className="max-w-sm space-y-1 text-xs">
        <p className="break-all">{data?.repositoryPath || workspace.path}</p>
        <p>{summary}</p>
        {error ? <p className="break-all">{error}</p> : data?.initialized ? <p className="text-muted">相对 HEAD 的已暂存与未暂存更改，包含未跟踪文件；二进制文件不计行数。点击打开 Git 操作。</p> : null}
      </Tooltip.Content>
    </Tooltip>
  </div>;
}

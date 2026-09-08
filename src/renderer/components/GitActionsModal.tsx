import { useRef, useState } from 'react';
import { Alert, Button, Spinner, toast } from '@heroui/react';
import { Command } from '@heroui-pro/react/command';
import { RiArrowRightLine, RiCloseLine, RiGitBranchLine, RiGitCommitLine, RiGitMergeLine,
  RiGitPullRequestLine, RiGithubLine, RiSearchLine, RiStackLine, RiUploadCloud2Line } from '@remixicon/react';
import { providerDisplayName } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { buildGitAgentPrompt, gitAgentActionGroups, type GitAgentActionId } from '../session/gitAgentActions';
import { ProviderIcon } from './ProviderIcon';

type Props = { session: TodeXSession; isOpen: boolean; onOpenChange: (open: boolean) => void };
const groupIcons = { repository: RiGitCommitLine, branches: RiGitBranchLine, worktrees: RiStackLine,
  collaboration: RiGitMergeLine };

export function GitActionsModal({ session, isOpen, onOpenChange }: Props) {
  const [sending, setSending] = useState<GitAgentActionId | null>(null);
  const [error, setError] = useState('');
  const sendingRef = useRef(false);
  const conversation = session.activeConversation;
  const workspace = session.workspaces.find(item => item.id === conversation?.workspaceId);
  const provider = conversation?.provider || 'codex';
  const unknown = conversation && session.submissionStatusByConversation[conversation.id] === 'unknown';
  const unavailable = !conversation || !workspace?.path || Boolean(unknown);
  const allActions = gitAgentActionGroups.flatMap(group => group.actions);

  const send = async (id: GitAgentActionId) => {
    if (sendingRef.current || unavailable || !conversation || !workspace) return;
    sendingRef.current = true;
    setSending(id);
    setError('');
    try {
      const outcome = await session.sendAgentMessage(buildGitAgentPrompt(id, {
        workspacePath: workspace.path, workspaceName: workspace.name,
      }), conversation.id);
      if (!outcome) {
        setError('请求尚未确认发送，请在当前对话中查看状态。');
        return;
      }
      onOpenChange(false);
      toast.success(outcome === 'queued' ? '已加入当前对话的候选队列' : '已发送到当前 Agent');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '消息发送失败');
    } finally {
      sendingRef.current = false;
      setSending(null);
    }
  };

  return <Command>
    <Command.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Command.Container className="w-[calc(100vw-2rem)] max-w-xl">
        <Command.Dialog aria-label="Git 操作" className="max-h-[88dvh] overflow-hidden">
          <Command.Header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><RiGithubLine className="size-5" />Git 操作</h2>
              <p className="mt-1 truncate text-sm" title={workspace?.path}>{workspace?.name || '未选择工作区'}</p>
              {workspace?.path ? <p className="text-muted mt-0.5 truncate text-xs" title={workspace.path}>{workspace.path}</p> : null}
            </div>
            <Button isIconOnly variant="ghost" size="sm" aria-label="关闭 Git 操作" onPress={() => onOpenChange(false)}><RiCloseLine className="size-5" /></Button>
          </Command.Header>
          <div className="text-muted flex items-center gap-2 px-5 pb-3 text-xs">
            <ProviderIcon provider={provider} className="size-4" />
            <span className="truncate">{conversation ? `发送到 ${providerDisplayName(provider)} · ${conversation.title}` : '请先选择一个 Agent 对话'}</span>
          </div>
          {unknown ? <p role="status" className="text-warning px-5 pb-3 text-sm">请先在对话中核对上一条消息的发送状态。</p> : null}
          {error ? <Alert status="warning" className="mx-4 mb-2"><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert> : null}
          <Command.InputGroup aria-label="搜索 Git 操作" className="mx-3">
            <Command.InputGroup.Prefix><RiSearchLine className="size-4" /></Command.InputGroup.Prefix>
            <Command.InputGroup.Input placeholder="搜索分支、工作树、PR…" />
            <Command.InputGroup.ClearButton aria-label="清除搜索" />
          </Command.InputGroup>
          <Command.List aria-label="Git 操作列表" className="min-h-0 max-h-[55dvh] overflow-y-auto px-3 pb-3"
            disabledKeys={unavailable || sending ? allActions.map(action => action.id) : []}
            onAction={key => { const action = allActions.find(item => item.id === String(key)); if (action) void send(action.id); }}
            renderEmptyState={() => <span>没有匹配的 Git 操作</span>}>
            {gitAgentActionGroups.map(group => {
              const GroupIcon = groupIcons[group.id as keyof typeof groupIcons] || RiGitBranchLine;
              return <Command.Group key={group.id} id={group.id} heading={group.title}>
                {group.actions.map(action => {
                  const Icon = action.id === 'create-pr' ? RiGitPullRequestLine
                    : action.id === 'push' || action.id === 'commit-and-push' ? RiUploadCloud2Line : GroupIcon;
                  return <Command.Item key={action.id} id={action.id} textValue={`${action.title} ${action.description} ${action.id}`}
                    className="group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2">
                    <Icon className="text-muted size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{action.title}</span>
                      <span className="text-muted block text-xs">{action.description}</span>
                    </div>
                    {sending === action.id ? <Spinner size="sm" /> : <RiArrowRightLine className="text-muted size-4 shrink-0 opacity-0 group-hover:opacity-100 group-data-[focused]:opacity-100" />}
                  </Command.Item>;
                })}
              </Command.Group>;
            })}
          </Command.List>
        </Command.Dialog>
      </Command.Container>
    </Command.Backdrop>
  </Command>;
}

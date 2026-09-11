import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Input, Label, Modal, Spinner, TextArea, TextField, toast } from '@heroui/react';
import { Command } from '@heroui-pro/react/command';
import { RiArrowRightLine, RiCloseLine, RiGitBranchLine, RiGitCommitLine, RiGitMergeLine,
  RiGitPullRequestLine, RiGithubLine, RiSearchLine, RiStackLine, RiUploadCloud2Line } from '@remixicon/react';
import { providerDisplayName } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { buildGitAgentPrompt, buildGitFailurePrompt, gitAgentActionGroups, type GitAgentActionId } from '../session/gitAgentActions';
import { GitWorkspaceError, readGitPullRequest, readGitWorkspace, runGitWorkspaceOperation, type GitPullRequestMethod, type GitPullRequestSnapshot, type GitWorkspaceOperation, type GitWorkspaceSnapshot } from '../lib/gitWorkspace';
import { ProviderIcon } from './ProviderIcon';
import { useNoticeToast } from './NoticeToast';

type Props = { session: TodeXSession; isOpen: boolean; onOpenChange: (open: boolean) => void };
const groupIcons = { repository: RiGitCommitLine, branches: RiGitBranchLine, worktrees: RiStackLine,
  collaboration: RiGitMergeLine };
const prViewActions = new Set<GitAgentActionId>(['view-pr', 'close-pr', 'reopen-pr', 'draft-pr', 'ready-pr',
  'merge-pr', 'enable-pr-auto-merge', 'disable-pr-auto-merge']);
const prMutationActions = new Set<GitAgentActionId>(['close-pr', 'reopen-pr', 'draft-pr', 'ready-pr',
  'merge-pr', 'enable-pr-auto-merge', 'disable-pr-auto-merge']);
const prMethods: readonly GitPullRequestMethod[] = ['merge', 'squash', 'rebase'];
const prMethodLabels: Record<GitPullRequestMethod, string> = { merge: '合并提交', squash: '压缩合并', rebase: '变基合并' };
const prMergeStateLabels: Record<string, string> = { clean: '干净', dirty: '有冲突', blocked: '被保护规则阻止',
  behind: '落后目标分支', unstable: '检查未通过', unknown: '计算中' };

export function GitActionsModal({ session, isOpen, onOpenChange }: Props) {
  const [sending, setSending] = useState<GitAgentActionId | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<GitAgentActionId | null>(null);
  const [snapshot, setSnapshot] = useState<GitWorkspaceSnapshot | null>(null);
  const [branchName, setBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [path, setPath] = useState('');
  const [removePath, setRemovePath] = useState('');
  const [output, setOutput] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prRepository, setPrRepository] = useState('');
  const [prBase, setPrBase] = useState('');
  const [prDraft, setPrDraft] = useState(false);
  const [pr, setPr] = useState<GitPullRequestSnapshot | null>(null);
  const [confirming, setConfirming] = useState<GitAgentActionId | null>(null);
  const [mergeMethod, setMergeMethod] = useState<GitPullRequestMethod>('merge');
  const [failure, setFailure] = useState<{ id: GitAgentActionId; operation?: unknown; error: string; unknown: boolean } | null>(null);
  const outcomeUnknown = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setView(null); setSnapshot(null); setPr(null); setConfirming(null); setError(''); setFailure(null); setOutput(''); setRemovePath('');
    outcomeUnknown.current = false;
    return () => { generation.current++; };
  }, [isOpen, session.activeConversation?.id, session.activeBackendConnectionId, session.settings?.serverUrl]);
  const sendingRef = useRef(false);
  const conversation = session.activeConversation;
  const workspace = session.workspaces.find(item => item.id === conversation?.workspaceId);
  const provider = conversation?.provider || 'codex';
  const unknown = conversation && session.submissionStatusByConversation[conversation.id] === 'unknown';
  const unavailable = !conversation || !workspace?.path || Boolean(unknown) || Boolean(workspace?.backendConnectionId && workspace.backendConnectionId !== session.activeBackendConnectionId);
  const writingBlocked = unavailable || Boolean(conversation && (session.thinkingConversations?.[conversation.id] || session.submissionStatusByConversation[conversation.id]));
  const allActions = gitAgentActionGroups.flatMap(group => group.actions);

  const send = async (id: GitAgentActionId, failed = false) => {
    if (sendingRef.current || unavailable || !conversation || !workspace) return;
    sendingRef.current = true;
    setSending(id);
    setError('');
    try {
      const outcome = await session.sendAgentMessage(failed && failure ? buildGitFailurePrompt(id, { workspacePath: workspace.path, workspaceName: workspace.name }, failure) : buildGitAgentPrompt(id, {
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

  const direct = async (id: GitAgentActionId, operation?: GitWorkspaceOperation) => {
    if (sendingRef.current || unavailable || !conversation || !workspace || (operation && (writingBlocked || outcomeUnknown.current))) return;
    sendingRef.current = true;
    const revision = generation.current;
    setSending(id); setError('');
    if (id !== 'create-pr' || operation || !outcomeUnknown.current) setFailure(null);
    if (id !== 'create-pr' || operation) setOutput('');
    try {
      if (operation) {
        const result = await runGitWorkspaceOperation(session.settings, workspace.path, operation);
        if (revision !== generation.current) return;
        setOutput(result.output || '操作已完成');
        setRemovePath('');
      }
      const result = await readGitWorkspace(session.settings, workspace.path);
      if (revision === generation.current) { setSnapshot(result); if (id !== 'create-pr' || operation) outcomeUnknown.current = false; }
    } catch (cause) {
      if (revision !== generation.current) return;
      const message = cause instanceof Error ? cause.message : 'Git 操作失败';
      const unknown = outcomeUnknown.current || (cause instanceof GitWorkspaceError && cause.unknownOutcome);
      outcomeUnknown.current = unknown;
      setError(message); setFailure({ id, operation, error: message, unknown });
    } finally {
      sendingRef.current = false;
      setSending(null);
    }
  };
  const prDirect = async (id: GitAgentActionId, operation?: GitWorkspaceOperation) => {
    if (sendingRef.current || unavailable || !conversation || !workspace || (operation && (writingBlocked || outcomeUnknown.current))) return;
    sendingRef.current = true;
    const revision = generation.current;
    setSending(id); setError('');
    try {
      if (operation) {
        const result = await runGitWorkspaceOperation(session.settings, workspace.path, operation);
        if (revision !== generation.current) return;
        setOutput(result.output || '操作已完成');
        setConfirming(null);
      }
      const result = await readGitPullRequest(session.settings, workspace.path);
      if (revision === generation.current) { setPr(result); outcomeUnknown.current = false; }
    } catch (cause) {
      if (revision !== generation.current) return;
      const message = cause instanceof Error ? cause.message : 'Git 操作失败';
      const unknown = outcomeUnknown.current || (cause instanceof GitWorkspaceError && cause.unknownOutcome);
      outcomeUnknown.current = unknown;
      setError(message); setFailure({ id, operation, error: message, unknown });
    } finally {
      sendingRef.current = false;
      setSending(null);
    }
  };
  const choose = (id: GitAgentActionId) => {
    if (allActions.find(action => action.id === id)?.mode === 'agent') { void send(id); return; }
    setView(id); setSnapshot(null); setPr(null); setError(''); setFailure(null); setOutput(''); setRemovePath('');
    setBranchName(''); setStartPoint(''); setPath('');
    setPrTitle(''); setPrBody(''); setPrRepository(''); setPrBase(''); setPrDraft(false);
    if (prViewActions.has(id)) {
      setConfirming(prMutationActions.has(id) ? id : null);
      void prDirect(id);
      return;
    }
    setConfirming(null);
    if (id === 'init' || id === 'push') void direct(id, { action: id });
    else void direct(id);
  };
  const isPrView = view !== null && prViewActions.has(view);
  const prItem = pr?.pullRequest ?? null;
  const workspaceState = isPrView ? pr : snapshot;
  const noticeScope = `${conversation?.id}:${session.activeBackendConnectionId}:${session.settings?.serverUrl}`;
  useNoticeToast(isOpen && error ? error : null, {
    variant: failure?.unknown ? 'warning' : 'danger',
    description: failure?.unknown ? '操作结果未知，请先核对实际状态。' : undefined,
    scope: noticeScope,
  });
  useNoticeToast(isOpen && view && !error && failure?.unknown ? '操作结果未知，请交给 Agent 核对实际状态后再重试。' : null, { scope: noticeScope });
  useNoticeToast(isOpen && view && workspaceState && !workspaceState.initialized ? '当前目录尚未初始化为 Git 仓库，请返回菜单选择初始化仓库。' : null, { scope: noticeScope });
  useNoticeToast(isOpen && view && writingBlocked ? '当前对话正在运行或等待确认，暂时不能修改 Git 状态。' : null, { scope: noticeScope });
  useNoticeToast(isOpen && !view && unknown ? '请先在对话中核对上一条消息的发送状态。' : null, { scope: noticeScope });
  const title = allActions.find(action => action.id === view)?.title || 'Git 操作';
  const isBranchForm = view === 'create-branch' || view === 'create-worktree';
  const prConfirm = (id: GitAgentActionId, label: string, operation: GitWorkspaceOperation,
    options?: { danger?: boolean; hint?: string; methodPicker?: boolean }) => confirming === id
    ? <div className="space-y-2 rounded-xl border border-default p-3">
        <p className="text-sm">{options?.hint || `确认${label}？`}</p>
        {options?.methodPicker ? <div className="flex items-center gap-1">
          <span className="text-muted text-xs">合并方式</span>
          {prMethods.map(method => <Button key={method} size="sm" variant={mergeMethod === method ? 'secondary' : 'ghost'} onPress={() => setMergeMethod(method)}>{prMethodLabels[method]}</Button>)}
        </div> : null}
        <div className="flex gap-2">
          <Button size="sm" variant={options?.danger ? 'danger' : 'secondary'} isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onPress={() => void prDirect(id, operation)}>确认{label}</Button>
          <Button size="sm" variant="ghost" onPress={() => setConfirming(null)}>取消</Button>
        </div>
      </div>
    : <Button size="sm" variant="secondary" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onPress={() => setConfirming(id)}>{label}</Button>;
  if (view) return <Modal>
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container><Modal.Dialog className="w-[calc(100vw-2rem)] max-w-xl max-h-[88dvh]">
        <Modal.Header><Modal.Heading>{title}</Modal.Heading><p className="text-muted break-all text-xs">{workspace?.path}</p></Modal.Header>
        <Modal.Body className="space-y-4 overflow-y-auto">
          <p className="text-muted text-xs">{isPrView
            ? `由工作区后端通过 GitHub API 直接执行${pr ? ` · ${pr.branch || '未提交或分离 HEAD'}` : ''}`
            : `由工作区后端直接执行 Git${snapshot ? ` · ${snapshot.currentBranch || '未提交或分离 HEAD'}${snapshot.dirty ? ' · 有未提交更改' : ''}` : ''}`}</p>
          {failure ? <Button size="sm" variant="secondary" isDisabled={unavailable || Boolean(sending)} onPress={() => void send(failure.id, true)}>交给 Agent 处理</Button> : null}
          {sending ? <div role="status" className="flex items-center gap-2"><Spinner size="sm" />处理中…</div> : null}
          {output ? <pre role="status" className="whitespace-pre-wrap break-all rounded-xl bg-default p-3 text-xs">{output}</pre> : null}
          {isPrView ? <div className="space-y-3">
            {pr?.initialized && !prItem ? <div className="space-y-2">
              <p className="text-sm">{pr.branch ? `当前分支 ${pr.branch} 没有对应的 PR。` : '当前处于分离 HEAD，没有对应的 PR。'}</p>
              <Button size="sm" variant="secondary" isDisabled={writingBlocked || Boolean(sending)} onPress={() => choose('create-pr')}>创建 PR</Button>
            </div> : null}
            {prItem ? <div className="space-y-2 rounded-xl border border-default p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-all text-sm font-medium">#{prItem.number} {prItem.title}</p>
                <Button size="sm" variant="ghost" isDisabled={!prItem.url} onPress={() => session.openPanel('Browser', { url: prItem.url })}>打开</Button>
              </div>
              <p className="text-muted break-all text-xs">{prItem.headRef} → {prItem.baseRef}{prItem.draft ? ' · 草稿' : ''}</p>
              <p className="text-muted text-xs">{prItem.state === 'merged' ? '已合并' : prItem.state === 'closed' ? '已关闭' : '开放'}
                {' · 检查 通过 '}{prItem.checks.passing}{' / 失败 '}{prItem.checks.failing}{' / 待运行 '}{prItem.checks.pending}
                {' · 审查 批准 '}{prItem.reviews.approved}{' / 请求修改 '}{prItem.reviews.changesRequested}{' / 评论 '}{prItem.reviews.commented}</p>
              <p className="text-muted text-xs">合并状态:{prItem.mergeable === 'unknown' ? '计算中' : prItem.mergeable === 'mergeable' ? '可合并' : `不可合并${prMergeStateLabels[prItem.mergeState] ? `(${prMergeStateLabels[prItem.mergeState]})` : ''}`}
                {prItem.autoMergeMethod ? ` · 自动合并已启用(${prMethodLabels[prItem.autoMergeMethod as GitPullRequestMethod] || prItem.autoMergeMethod})` : ''}</p>
            </div> : null}
            {prItem?.state === 'open' ? <div className="flex flex-wrap gap-2">
              {prItem.draft
                ? prConfirm('ready-pr', '标记可供审查', { action: 'ready-pr' }, { hint: `将 #${prItem.number} 标记为可供审查？` })
                : prConfirm('draft-pr', '转为草稿', { action: 'draft-pr' }, { hint: `将 #${prItem.number} 转为草稿？` })}
              {prConfirm('close-pr', '关闭 PR', { action: 'close-pr' }, { danger: true, hint: `关闭 #${prItem.number}？分支将保留。` })}
            </div> : null}
            {prItem?.state === 'closed' ? prConfirm('reopen-pr', '重新打开', { action: 'reopen-pr' }, { hint: `重新打开 #${prItem.number}？` }) : null}
            {prItem?.state === 'open' ? <div className="space-y-2 rounded-xl border border-default p-3">
              <p className="text-sm font-medium">合并</p>
              {prItem.autoMergeMethod
                ? prConfirm('disable-pr-auto-merge', '取消自动合并', { action: 'disable-pr-auto-merge' }, { hint: '取消此 PR 的自动合并安排？' })
                : prConfirm('enable-pr-auto-merge', '启用自动合并', { action: 'enable-pr-auto-merge', method: mergeMethod }, { hint: '满足仓库合并条件后由 GitHub 自动合并。', methodPicker: true })}
              {prConfirm('merge-pr', '合并 PR', { action: 'merge-pr', method: mergeMethod, headSha: prItem.headSha }, { danger: true, hint: `按所选方式合并 #${prItem.number}？GitHub 将校验保护规则与检查状态。`, methodPicker: true })}
            </div> : null}
          </div> : null}
          {view === 'create-pr' ? <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            if (!prTitle.trim() || !prBase.trim() || !prRepository.trim() || output) return;
            void direct('create-pr', { action: 'create-pr', title: prTitle.trim(), body: prBody,
              baseBranch: prBase.trim(), repository: prRepository.trim(), draft: prDraft });
          }}>
            <p className="text-muted text-sm">为已推送的当前分支创建 PR。未提交的更改不会包含在 PR 中；请先通过提交与推送操作准备分支。</p>
            <TextField isRequired value={prRepository} onChange={setPrRepository}><Label>GitHub 仓库</Label><Input placeholder="owner/repository 或 host/owner/repository" /></TextField>
            <TextField isRequired value={prBase} onChange={setPrBase}><Label>目标分支</Label><Input placeholder="例如 main" /></TextField>
            <TextField isRequired value={prTitle} onChange={setPrTitle}><Label>PR 标题</Label><Input placeholder="概括本次更改" maxLength={256} /></TextField>
            <TextField value={prBody} onChange={setPrBody}><Label>PR 描述</Label><TextArea rows={5} placeholder="更改内容、原因与验证结果" /></TextField>
            <Checkbox isSelected={prDraft} onChange={setPrDraft}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>创建为草稿</Checkbox.Content></Checkbox>
            <Button type="submit" isDisabled={writingBlocked || Boolean(sending) || outcomeUnknown.current || Boolean(output) || !snapshot?.initialized || !snapshot.currentBranch || !prTitle.trim() || !prBase.trim() || !prRepository.trim()}>创建 PR</Button>
            {output ? <Button variant="secondary" isDisabled={unavailable || Boolean(sending)} onPress={() => void send('view-pr')}>交给 Agent 查看 PR</Button> : null}
          </form> : null}
          {isBranchForm ? <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            if (!branchName.trim() || (view === 'create-worktree' && !path.trim())) return;
            void direct(view, view === 'create-worktree'
              ? { action: 'create-worktree', path: path.trim(), branchName: branchName.trim(), ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}) }
              : { action: 'create-branch', branchName: branchName.trim(), ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}) });
          }}>
            <TextField isRequired value={branchName} onChange={setBranchName}><Label>新分支名称</Label><Input placeholder="codex/my-task" /></TextField>
            <TextField value={startPoint} onChange={setStartPoint}><Label>起点（可选）</Label><Input placeholder="默认 HEAD" /></TextField>
            {view === 'create-worktree' ? <TextField isRequired value={path} onChange={setPath}><Label>新工作树绝对路径</Label><Input placeholder="后端允许目录内的新路径" /></TextField> : <p className="text-muted text-xs">创建分支后仍停留在当前分支。</p>}
            <Button type="submit" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || !snapshot?.initialized}>{title}</Button>
          </form> : null}
          {(view === 'list-branches' || view === 'switch-branch') && snapshot ? <div className="space-y-2">
            {snapshot.branches.length === 0 ? <p>暂无分支，请先完成首次提交。</p> : snapshot.branches.map(branch => <div key={branch.name} className="flex items-center justify-between gap-3 rounded-xl border border-default p-3">
              <div className="min-w-0"><p className="break-all text-sm">{branch.name}{branch.current ? ' · 当前' : ''}{branch.remote ? ' · 远端' : ''}</p>{branch.worktreePath ? <p className="text-muted break-all text-xs">{branch.worktreePath}</p> : null}</div>
              {view === 'switch-branch' && !branch.remote ? <Button size="sm" variant="secondary" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || snapshot.dirty || branch.current || Boolean(branch.worktreePath)} onPress={() => void direct(view, { action: 'switch-branch', branchName: branch.name })}>切换</Button> : null}
            </div>)}
          </div> : null}
          {(view === 'list-worktrees' || view === 'switch-worktree' || view === 'manage-worktrees') && snapshot ? <div className="space-y-3">
            {view === 'switch-worktree' ? <p className="text-muted text-xs">打开目标工作区的对话；如需迁移当前任务上下文，请使用 Handoff。</p> : null}
            {snapshot.worktrees.map(tree => <div key={tree.path} className="space-y-2 rounded-xl border border-default p-3">
              <p className="break-all text-sm">{tree.branch || '分离 HEAD'}{tree.current ? ' · 当前' : ''}{tree.main ? ' · 主工作树' : ''}</p><p className="text-muted break-all text-xs">{tree.path}</p>
              <p className="text-muted text-xs">{!tree.accessible ? '不可访问' : tree.dirty ? '有未提交更改' : '干净'}{tree.locked ? ' · 已锁定' : ''}</p>
              {view === 'switch-worktree' ? <Button size="sm" variant="secondary" isDisabled={Boolean(sending) || tree.current || !tree.accessible} onPress={() => {
                if (conversation && session.openGitWorktree(tree.path, conversation.id)) onOpenChange(false);
              }}>打开工作区</Button> : null}
              {view === 'manage-worktrees' ? removePath === tree.path ? <div className="space-y-2"><p className="text-sm">移除以上工作树目录？分支将保留。</p><Button size="sm" variant="danger" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onPress={() => void direct(view, { action: 'remove-worktree', path: tree.path })}>确认移除</Button><Button size="sm" variant="ghost" onPress={() => setRemovePath('')}>取消</Button></div> : <Button size="sm" variant="secondary" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || tree.main || tree.current || tree.dirty || tree.locked || !tree.accessible} onPress={() => setRemovePath(tree.path)}>移除工作树</Button> : null}
            </div>)}
          </div> : null}
        </Modal.Body>
        <Modal.Footer><Button variant="ghost" isDisabled={Boolean(sending)} onPress={() => { setView(null); setError(''); setFailure(null); }}>返回菜单</Button><Button variant="secondary" isDisabled={Boolean(sending)} onPress={() => void (isPrView ? prDirect(view) : direct(view))}>刷新状态</Button><Button onPress={() => onOpenChange(false)}>关闭</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  </Modal>;

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
            <span className="truncate">{conversation ? `需推理的操作发送到 ${providerDisplayName(provider)} · ${conversation.title}` : '请先选择一个 Agent 对话'}</span>
          </div>
          <Command.InputGroup aria-label="搜索 Git 操作" className="mx-3">
            <Command.InputGroup.Prefix><RiSearchLine className="size-4" /></Command.InputGroup.Prefix>
            <Command.InputGroup.Input placeholder="搜索分支、工作树、PR…" />
            <Command.InputGroup.ClearButton aria-label="清除搜索" />
          </Command.InputGroup>
          <Command.List aria-label="Git 操作列表" className="min-h-0 max-h-[55dvh] overflow-y-auto px-3 pb-3"
            disabledKeys={allActions.filter(action => unavailable || sending || (writingBlocked && (action.id === 'init' || action.id === 'push'))).map(action => action.id)}
            onAction={key => { const action = allActions.find(item => item.id === String(key)); if (action) choose(action.id); }}
            renderEmptyState={() => <span>没有匹配的 Git 操作</span>}>
            {gitAgentActionGroups.map(group => {
              const GroupIcon = groupIcons[group.id as keyof typeof groupIcons] || RiGitBranchLine;
              return <Command.Group key={group.id} id={group.id} heading={group.title}>
                {group.actions.map(action => {
                  const Icon = group.id.startsWith('pr-') || group.id === 'pull-requests' ? RiGitPullRequestLine
                    : action.id === 'push' || action.id === 'commit-and-push' ? RiUploadCloud2Line : GroupIcon;
                  return <Command.Item key={action.id} id={action.id} textValue={`${action.title} ${action.description} ${action.id}`}
                    className="group flex min-h-14 items-center gap-3 rounded-xl px-3 py-2">
                    <Icon className="text-muted size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{action.title}</span>
                      <span className="text-muted block text-xs">{action.description} · {action.mode === 'agent' ? 'Agent' : '直接执行'}</span>
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

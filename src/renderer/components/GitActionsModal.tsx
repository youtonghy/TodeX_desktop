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
import { useT, type MessageKey } from '../i18n';

type Props = { session: TodeXSession; isOpen: boolean; onOpenChange: (open: boolean) => void };
const groupIcons = { repository: RiGitCommitLine, branches: RiGitBranchLine, worktrees: RiStackLine,
  collaboration: RiGitMergeLine };
const prViewActions = new Set<GitAgentActionId>(['view-pr', 'close-pr', 'reopen-pr', 'draft-pr', 'ready-pr',
  'merge-pr', 'enable-pr-auto-merge', 'disable-pr-auto-merge']);
const prMutationActions = new Set<GitAgentActionId>(['close-pr', 'reopen-pr', 'draft-pr', 'ready-pr',
  'merge-pr', 'enable-pr-auto-merge', 'disable-pr-auto-merge']);
const prMethods: readonly GitPullRequestMethod[] = ['merge', 'squash', 'rebase'];
const prMethodLabelKeys: Record<GitPullRequestMethod, MessageKey> = { merge: 'git.methodMerge', squash: 'git.methodSquash', rebase: 'git.methodRebase' };
const prMergeStateLabelKeys: Record<string, MessageKey> = { clean: 'git.mergeStateClean', dirty: 'git.mergeStateDirty', blocked: 'git.mergeStateBlocked',
  behind: 'git.mergeStateBehind', unstable: 'git.mergeStateUnstable', unknown: 'git.mergeStateUnknown' };

export function GitActionsModal({ session, isOpen, onOpenChange }: Props) {
  const t = useT();
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
        setError(t('git.sendUnconfirmed'));
        return;
      }
      onOpenChange(false);
      toast.success(outcome === 'queued' ? t('git.queued') : t('git.sentToAgent'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('git.sendFailed'));
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
        setOutput(result.output || t('git.operationDone'));
        setRemovePath('');
      }
      const result = await readGitWorkspace(session.settings, workspace.path);
      if (revision === generation.current) { setSnapshot(result); if (id !== 'create-pr' || operation) outcomeUnknown.current = false; }
    } catch (cause) {
      if (revision !== generation.current) return;
      const message = cause instanceof Error ? cause.message : t('git.operationFailed');
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
        setOutput(result.output || t('git.operationDone'));
        setConfirming(null);
      }
      const result = await readGitPullRequest(session.settings, workspace.path);
      if (revision === generation.current) { setPr(result); outcomeUnknown.current = false; }
    } catch (cause) {
      if (revision !== generation.current) return;
      const message = cause instanceof Error ? cause.message : t('git.operationFailed');
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
    description: failure?.unknown ? t('git.unknownOutcome') : undefined,
    scope: noticeScope,
  });
  useNoticeToast(isOpen && view && !error && failure?.unknown ? t('git.unknownOutcomeRetry') : null, { scope: noticeScope });
  useNoticeToast(isOpen && view && workspaceState && !workspaceState.initialized ? t('git.notInitializedHint') : null, { scope: noticeScope });
  useNoticeToast(isOpen && view && writingBlocked ? t('git.writingBlocked') : null, { scope: noticeScope });
  useNoticeToast(isOpen && !view && unknown ? t('git.checkSendStatus') : null, { scope: noticeScope });
  const title = allActions.find(action => action.id === view)?.title || t('git.operations');
  const isBranchForm = view === 'create-branch' || view === 'create-worktree';
  const prConfirm = (id: GitAgentActionId, label: string, operation: GitWorkspaceOperation,
    options?: { danger?: boolean; hint?: string; methodPicker?: boolean }) => confirming === id
    ? <div className="space-y-2 rounded-xl border border-default p-3">
        <p className="text-sm">{options?.hint || t('git.confirmHint', { label })}</p>
        {options?.methodPicker ? <div className="flex items-center gap-1">
          <span className="text-muted text-xs">{t('git.mergeMethod')}</span>
          {prMethods.map(method => <Button key={method} size="sm" variant={mergeMethod === method ? 'secondary' : 'ghost'} onPress={() => setMergeMethod(method)}>{t(prMethodLabelKeys[method])}</Button>)}
        </div> : null}
        <div className="flex gap-2">
          <Button size="sm" variant={options?.danger ? 'danger' : 'secondary'} isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onPress={() => void prDirect(id, operation)}>{t('git.confirmLabel', { label })}</Button>
          <Button size="sm" variant="ghost" onPress={() => setConfirming(null)}>{t('common.cancel')}</Button>
        </div>
      </div>
    : <Button size="sm" variant="secondary" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onPress={() => setConfirming(id)}>{label}</Button>;
  if (view) return <Modal>
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container><Modal.Dialog className="w-[calc(100vw-2rem)] max-w-xl max-h-[88dvh]">
        <Modal.Header><Modal.Heading>{title}</Modal.Heading><p className="text-muted break-all text-xs">{workspace?.path}</p></Modal.Header>
        <Modal.Body className="space-y-4 overflow-y-auto">
          <p className="text-muted text-xs">{isPrView
            ? t('git.execViaGithubApi', { detail: pr ? ` · ${pr.branch || t('git.noCommitDetached')}` : '' })
            : t('git.execDirectGit', { detail: snapshot ? ` · ${snapshot.currentBranch || t('git.noCommitDetached')}${snapshot.dirty ? ` · ${t('git.dirtyChanges')}` : ''}` : '' })}</p>
          {failure ? <Button size="sm" variant="secondary" isDisabled={unavailable || Boolean(sending)} onPress={() => void send(failure.id, true)}>{t('git.handToAgent')}</Button> : null}
          {sending ? <div role="status" className="flex items-center gap-2"><Spinner size="sm" />{t('git.processing')}</div> : null}
          {output ? <pre role="status" className="whitespace-pre-wrap break-all rounded-xl bg-default p-3 text-xs">{output}</pre> : null}
          {isPrView ? <div className="space-y-3">
            {pr?.initialized && !prItem ? <div className="space-y-2">
              <p className="text-sm">{pr.branch ? t('git.noPrOnBranch', { branch: pr.branch }) : t('git.noPrDetached')}</p>
              <Button size="sm" variant="secondary" isDisabled={writingBlocked || Boolean(sending)} onPress={() => choose('create-pr')}>{t('git.createPrTitle')}</Button>
            </div> : null}
            {prItem ? <div className="space-y-2 rounded-xl border border-default p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-all text-sm font-medium">#{prItem.number} {prItem.title}</p>
                <Button size="sm" variant="ghost" isDisabled={!prItem.url} onPress={() => session.openPanel('Browser', { url: prItem.url })}>{t('git.open')}</Button>
              </div>
              <p className="text-muted break-all text-xs">{prItem.headRef} → {prItem.baseRef}{prItem.draft ? ` · ${t('git.draft')}` : ''}</p>
              <p className="text-muted text-xs">{prItem.state === 'merged' ? t('git.prStateMerged') : prItem.state === 'closed' ? t('git.prStateClosed') : t('git.prStateOpen')}
                {' · '}{t('git.prChecksLine', { passing: prItem.checks.passing, failing: prItem.checks.failing, pending: prItem.checks.pending, approved: prItem.reviews.approved, changes: prItem.reviews.changesRequested, comments: prItem.reviews.commented })}</p>
              <p className="text-muted text-xs">{t('git.mergeStatus', { status: prItem.mergeable === 'unknown' ? t('git.mergeStateUnknown') : prItem.mergeable === 'mergeable' ? t('git.mergeable') : t('git.unmergeable', { detail: prMergeStateLabelKeys[prItem.mergeState] ? `(${t(prMergeStateLabelKeys[prItem.mergeState])})` : '' }) })}
                {prItem.autoMergeMethod ? ` · ${t('git.autoMergeOn', { method: prMethodLabelKeys[prItem.autoMergeMethod as GitPullRequestMethod] ? t(prMethodLabelKeys[prItem.autoMergeMethod as GitPullRequestMethod]) : prItem.autoMergeMethod })}` : ''}</p>
            </div> : null}
            {prItem?.state === 'open' ? <div className="flex flex-wrap gap-2">
              {prItem.draft
                ? prConfirm('ready-pr', t('git.readyPrTitle'), { action: 'ready-pr' }, { hint: t('git.readyPrHint', { number: prItem.number }) })
                : prConfirm('draft-pr', t('git.draftPrTitle'), { action: 'draft-pr' }, { hint: t('git.draftPrHint', { number: prItem.number }) })}
              {prConfirm('close-pr', t('git.closePrTitle'), { action: 'close-pr' }, { danger: true, hint: t('git.closePrHint', { number: prItem.number }) })}
            </div> : null}
            {prItem?.state === 'closed' ? prConfirm('reopen-pr', t('git.reopenPr'), { action: 'reopen-pr' }, { hint: t('git.reopenPrHint', { number: prItem.number }) }) : null}
            {prItem?.state === 'open' ? <div className="space-y-2 rounded-xl border border-default p-3">
              <p className="text-sm font-medium">{t('git.merge')}</p>
              {prItem.autoMergeMethod
                ? prConfirm('disable-pr-auto-merge', t('git.disablePrAutoMergeTitle'), { action: 'disable-pr-auto-merge' }, { hint: t('git.disableAutoMergeHint') })
                : prConfirm('enable-pr-auto-merge', t('git.enablePrAutoMergeTitle'), { action: 'enable-pr-auto-merge', method: mergeMethod }, { hint: t('git.enableAutoMergeHint'), methodPicker: true })}
              {prConfirm('merge-pr', t('git.mergePrTitle'), { action: 'merge-pr', method: mergeMethod, headSha: prItem.headSha }, { danger: true, hint: t('git.mergePrHint', { number: prItem.number }), methodPicker: true })}
            </div> : null}
          </div> : null}
          {view === 'create-pr' ? <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            if (!prTitle.trim() || !prBase.trim() || !prRepository.trim() || output) return;
            void direct('create-pr', { action: 'create-pr', title: prTitle.trim(), body: prBody,
              baseBranch: prBase.trim(), repository: prRepository.trim(), draft: prDraft });
          }}>
            <p className="text-muted text-sm">{t('git.createPrHint')}</p>
            <TextField isRequired value={prRepository} onChange={setPrRepository}><Label>{t('git.repoLabel')}</Label><Input placeholder={t('git.repoPlaceholder')} /></TextField>
            <TextField isRequired value={prBase} onChange={setPrBase}><Label>{t('git.baseBranch')}</Label><Input placeholder={t('git.baseBranchPlaceholder')} /></TextField>
            <TextField isRequired value={prTitle} onChange={setPrTitle}><Label>{t('git.prTitleLabel')}</Label><Input placeholder={t('git.prTitlePlaceholder')} maxLength={256} /></TextField>
            <TextField value={prBody} onChange={setPrBody}><Label>{t('git.prBodyLabel')}</Label><TextArea rows={5} placeholder={t('git.prBodyPlaceholder')} /></TextField>
            <Checkbox isSelected={prDraft} onChange={setPrDraft}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('git.createAsDraft')}</Checkbox.Content></Checkbox>
            <Button type="submit" isDisabled={writingBlocked || Boolean(sending) || outcomeUnknown.current || Boolean(output) || !snapshot?.initialized || !snapshot.currentBranch || !prTitle.trim() || !prBase.trim() || !prRepository.trim()}>{t('git.createPrTitle')}</Button>
            {output ? <Button variant="secondary" isDisabled={unavailable || Boolean(sending)} onPress={() => void send('view-pr')}>{t('git.letAgentViewPr')}</Button> : null}
          </form> : null}
          {isBranchForm ? <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            if (!branchName.trim() || (view === 'create-worktree' && !path.trim())) return;
            void direct(view, view === 'create-worktree'
              ? { action: 'create-worktree', path: path.trim(), branchName: branchName.trim(), ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}) }
              : { action: 'create-branch', branchName: branchName.trim(), ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}) });
          }}>
            <TextField isRequired value={branchName} onChange={setBranchName}><Label>{t('git.newBranchName')}</Label><Input placeholder="codex/my-task" /></TextField>
            <TextField value={startPoint} onChange={setStartPoint}><Label>{t('git.startPoint')}</Label><Input placeholder={t('git.startPointPlaceholder')} /></TextField>
            {view === 'create-worktree' ? <TextField isRequired value={path} onChange={setPath}><Label>{t('git.newWorktreePath')}</Label><Input placeholder={t('git.worktreePathPlaceholder')} /></TextField> : <p className="text-muted text-xs">{t('git.branchStays')}</p>}
            <Button type="submit" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || !snapshot?.initialized}>{title}</Button>
          </form> : null}
          {(view === 'list-branches' || view === 'switch-branch') && snapshot ? <div className="space-y-2">
            {snapshot.branches.length === 0 ? <p>{t('git.noBranches')}</p> : snapshot.branches.map(branch => <div key={branch.name} className="flex items-center justify-between gap-3 rounded-xl border border-default p-3">
              <div className="min-w-0"><p className="break-all text-sm">{branch.name}{branch.current ? ` · ${t('git.currentBranch')}` : ''}{branch.remote ? ` · ${t('git.remoteBranch')}` : ''}</p>{branch.worktreePath ? <p className="text-muted break-all text-xs">{branch.worktreePath}</p> : null}</div>
              {view === 'switch-branch' && !branch.remote ? <Button size="sm" variant="secondary" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || snapshot.dirty || branch.current || Boolean(branch.worktreePath)} onPress={() => void direct(view, { action: 'switch-branch', branchName: branch.name })}>{t('git.switch')}</Button> : null}
            </div>)}
          </div> : null}
          {(view === 'list-worktrees' || view === 'switch-worktree' || view === 'manage-worktrees') && snapshot ? <div className="space-y-3">
            {view === 'switch-worktree' ? <p className="text-muted text-xs">{t('git.switchWorktreeHint')}</p> : null}
            {snapshot.worktrees.map(tree => <div key={tree.path} className="space-y-2 rounded-xl border border-default p-3">
              <p className="break-all text-sm">{tree.branch || t('git.detachedHead')}{tree.current ? ` · ${t('git.currentBranch')}` : ''}{tree.main ? ` · ${t('git.mainWorktree')}` : ''}</p><p className="text-muted break-all text-xs">{tree.path}</p>
              <p className="text-muted text-xs">{!tree.accessible ? t('git.worktreeInaccessible') : tree.dirty ? t('git.dirtyChanges') : t('git.mergeStateClean')}{tree.locked ? ` · ${t('git.locked')}` : ''}</p>
              {view === 'switch-worktree' ? <Button size="sm" variant="secondary" isDisabled={Boolean(sending) || tree.current || !tree.accessible} onPress={() => {
                if (conversation && session.openGitWorktree(tree.path, conversation.id)) onOpenChange(false);
              }}>{t('git.openWorktree')}</Button> : null}
              {view === 'manage-worktrees' ? removePath === tree.path ? <div className="space-y-2"><p className="text-sm">{t('git.removeWorktreeConfirm')}</p><Button size="sm" variant="danger" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onPress={() => void direct(view, { action: 'remove-worktree', path: tree.path })}>{t('git.confirmRemove')}</Button><Button size="sm" variant="ghost" onPress={() => setRemovePath('')}>{t('common.cancel')}</Button></div> : <Button size="sm" variant="secondary" isDisabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || tree.main || tree.current || tree.dirty || tree.locked || !tree.accessible} onPress={() => setRemovePath(tree.path)}>{t('git.removeWorktree')}</Button> : null}
            </div>)}
          </div> : null}
        </Modal.Body>
        <Modal.Footer><Button variant="ghost" isDisabled={Boolean(sending)} onPress={() => { setView(null); setError(''); setFailure(null); }}>{t('git.backToMenu')}</Button><Button variant="secondary" isDisabled={Boolean(sending)} onPress={() => void (isPrView ? prDirect(view) : direct(view))}>{t('git.refreshStatus')}</Button><Button onPress={() => onOpenChange(false)}>{t('controls.close')}</Button></Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>
  </Modal>;

  return <Command>
    <Command.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Command.Container className="w-[calc(100vw-2rem)] max-w-xl">
        <Command.Dialog aria-label={t('git.operations')} className="max-h-[88dvh] overflow-hidden">
          <Command.Header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><RiGithubLine className="size-5" />{t('git.operations')}</h2>
              <p className="mt-1 truncate text-sm" title={workspace?.path}>{workspace?.name || t('git.noWorkspace')}</p>
              {workspace?.path ? <p className="text-muted mt-0.5 truncate text-xs" title={workspace.path}>{workspace.path}</p> : null}
            </div>
            <Button isIconOnly variant="ghost" size="sm" aria-label={t('git.closeOperations')} onPress={() => onOpenChange(false)}><RiCloseLine className="size-5" /></Button>
          </Command.Header>
          <div className="text-muted flex items-center gap-2 px-5 pb-3 text-xs">
            <ProviderIcon provider={provider} className="size-4" />
            <span className="truncate">{conversation ? t('git.sendTo', { provider: providerDisplayName(provider), title: conversation.title }) : t('git.pickAgent')}</span>
          </div>
          <Command.InputGroup aria-label={t('git.searchOps')} className="mx-3">
            <Command.InputGroup.Prefix><RiSearchLine className="size-4" /></Command.InputGroup.Prefix>
            <Command.InputGroup.Input placeholder={t('git.searchPlaceholder')} />
            <Command.InputGroup.ClearButton aria-label={t('git.clearSearch')} />
          </Command.InputGroup>
          <Command.List aria-label={t('git.opsList')} className="min-h-0 max-h-[55dvh] overflow-y-auto px-3 pb-3"
            disabledKeys={allActions.filter(action => unavailable || sending || (writingBlocked && (action.id === 'init' || action.id === 'push'))).map(action => action.id)}
            onAction={key => { const action = allActions.find(item => item.id === String(key)); if (action) choose(action.id); }}
            renderEmptyState={() => <span>{t('git.noMatch')}</span>}>
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
                      <span className="text-muted block text-xs">{action.description} · {action.mode === 'agent' ? 'Agent' : t('git.modeDirect')}</span>
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

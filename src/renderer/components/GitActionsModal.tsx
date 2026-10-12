import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Autocomplete, Button as AriaButton, MenuItem as AriaMenuItem, SearchField, useFilter } from 'react-aria-components';
import { RiArrowRightLine, RiArrowUpLine, RiCloseLine, RiExternalLinkLine, RiFlashlightLine, RiGitBranchLine, RiGitCommitLine, RiGitMergeLine,
  RiGitPullRequestLine, RiGithubLine, RiPulseLine, RiSearchLine, RiStackLine, RiUploadCloud2Line } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button, ButtonLink } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { MENU_ITEM_ACTIVE } from '@/components/base/dropdown/menu-styles';
import { Input, InputBase } from '@/components/base/input/input';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { Tab, TabList, TabPanel, Tabs } from '@/components/base/tabs/tabs';
import { Textarea } from '@/components/base/textarea/textarea';
import { Menu, MenuSection } from '@/components/ui/menu';
import { Modal, ModalCloseButton } from '@/components/ui/modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner, SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { providerDisplayName } from '@todex/protocol/v2';
import { filesWorkspaceForConversation } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import { buildGitAgentPrompt, buildGitFailurePrompt, gitAgentActionGroups, type GitAgentActionId } from '../session/gitAgentActions';
import { externalHttpUrl, GitWorkspaceError, readGitPullRequest, readGitWorkspace, runGitWorkspaceOperation, type GitPullRequestMethod, type GitPullRequestSnapshot, type GitWorkspaceOperation, type GitWorkspaceSnapshot } from '../lib/gitWorkspace';
import { useConversationGitStatus } from './GitStatusIndicator';
import { GitStatusOverview } from './GitStatusOverview';
import { useGitOverview } from '../session/useGitOverview';
import { ProviderIcon } from './ProviderIcon';
import { useNoticeToast } from './NoticeToast';
import { useT, type MessageKey } from '../i18n';

type Props = { session: TodeXSession; isOpen: boolean; onOpenChange: (open: boolean) => void };
type MenuTab = 'status' | 'operations';
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

/** Small status chip with an optional leading glyph. */
function Tag({ color = 'neutral', children }: { color?: 'neutral' | 'blue' | 'lime' | 'yellow'; children: ReactNode }) {
  return <Chip variant="caption" color={color} className="gap-1 px-1.5 py-0.5">{children}</Chip>;
}

/** Grouped section inside the dialog (the secondary card recipe). */
const GROUP_CARD = 'rounded-2xl bg-background-secondary-default p-3';

export function GitActionsModal({ session, isOpen, onOpenChange }: Props) {
  const t = useT();
  const [sending, setSending] = useState<GitAgentActionId | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<GitAgentActionId | null>(null);
  const [snapshot, setSnapshot] = useState<GitWorkspaceSnapshot | null>(null);
  const [branchName, setBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
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
  const [tab, setTab] = useState<MenuTab>('status');
  const [jumpGroup, setJumpGroup] = useState<string | null>(null);
  const outcomeUnknown = useRef(false);
  const generation = useRef(0);
  const opsListRef = useRef<HTMLDivElement>(null);
  const { contains } = useFilter({ sensitivity: 'base' });
  useEffect(() => {
    generation.current++;
    setView(null); setSnapshot(null); setPr(null); setConfirming(null); setError(''); setFailure(null); setOutput(''); setRemovePath('');
    setTab('status'); setJumpGroup(null);
    outcomeUnknown.current = false;
    return () => { generation.current++; };
  }, [isOpen, session.activeConversation?.id, session.activeBackendConnectionId, session.settings?.serverUrl]);
  const sendingRef = useRef(false);
  const conversation = session.activeConversation;
  const workspace = filesWorkspaceForConversation(session.workspaces.find(item => item.id === conversation?.workspaceId), conversation);
  const git = useConversationGitStatus(session, isOpen, isOpen);
  const repoPath = git.selectedPath || workspace?.path || '';
  // Reloads whenever the menu (re)appears, including after returning from an action view.
  const overview = useGitOverview({ settings: session.settings, repoPath, enabled: isOpen && !view && git.connected });
  useEffect(() => {
    if (tab !== 'operations' || !jumpGroup) return;
    const firstAction = gitAgentActionGroups.find(group => group.id === jumpGroup)?.actions[0]?.id;
    setJumpGroup(null);
    // Menu sections render no id; their first item carries the action id as
    // data-key. The list fills in after the tab panel mounts, so wait a frame.
    requestAnimationFrame(() => {
      opsListRef.current?.querySelector(`[data-key="${firstAction}"]`)
        ?.closest('section')?.scrollIntoView({ block: 'start' });
    });
  }, [tab, jumpGroup]);
  const chooseRepo = (key: React.Key | null) => {
    const path = typeof key === 'string' ? key : '';
    if (!workspace || !path || path === repoPath) return;
    git.selectRepo(path);
    generation.current++;
    setView(null); setSnapshot(null); setPr(null); setConfirming(null);
    setError(''); setFailure(null); setOutput(''); setRemovePath('');
  };
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
      const outcome = await session.sendAgentMessage(failed && failure ? buildGitFailurePrompt(id, { workspacePath: repoPath, workspaceName: workspace.name }, failure) : buildGitAgentPrompt(id, {
        workspacePath: repoPath, workspaceName: workspace.name,
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
        const result = await runGitWorkspaceOperation(session.settings, repoPath, operation);
        if (revision !== generation.current) return;
        if (operation.action === 'create-worktree'
          && session.openGitWorktree(operation.path, conversation.id)) {
          onOpenChange(false);
          toast.success(t('git.worktreeOpened'));
          return;
        }
        setOutput(result.output || t('git.operationDone'));
        setRemovePath('');
      }
      const result = await readGitWorkspace(session.settings, repoPath);
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
        const result = await runGitWorkspaceOperation(session.settings, repoPath, operation);
        if (revision !== generation.current) return;
        setOutput(result.output || t('git.operationDone'));
        setConfirming(null);
      }
      const result = await readGitPullRequest(session.settings, repoPath);
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
    setBranchName(''); setStartPoint('');
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
  const prUrl = externalHttpUrl(prItem?.url);
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
  const worktreeName = branchName.trim().replace(/^\/+|\/+$/g, '').replace(/^todex\//, '');
  const worktreeAnchor = snapshot?.worktrees.find(tree => tree.main)?.path || snapshot?.repositoryPath || repoPath;
  const worktreeBase = worktreeAnchor.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '');
  const worktreeBranch = worktreeName ? `todex/${worktreeName}` : '';
  const worktreePath = worktreeName && worktreeBase ? `${worktreeBase}/todex/${worktreeName}` : '';
  const prConfirm = (id: GitAgentActionId, label: string, operation: GitWorkspaceOperation,
    options?: { danger?: boolean; hint?: string; methodPicker?: boolean }) => confirming === id
    ? <div className={cx(GROUP_CARD, 'space-y-2')}>
        <p className="text-body-regular text-text-primary">{options?.hint || t('git.confirmHint', { label })}</p>
        {options?.methodPicker ? <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption-1-regular text-text-secondary">{t('git.mergeMethod')}</span>
          <SegmentedControl aria-label={t('git.mergeMethod')} selectedKeys={[mergeMethod]}
            onSelectionChange={keys => { const next = [...keys][0]; if (next) setMergeMethod(next as GitPullRequestMethod); }}>
            {prMethods.map(method => <SegmentedControlItem key={method} id={method}>{t(prMethodLabelKeys[method])}</SegmentedControlItem>)}
          </SegmentedControl>
        </div> : null}
        <div className="flex gap-2">
          <Button size="small" variant={options?.danger ? 'danger' : 'primary'} disabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onClick={() => void prDirect(id, operation)}>{t('git.confirmLabel', { label })}</Button>
          <Button size="small" variant="secondary" onClick={() => setConfirming(null)}>{t('common.cancel')}</Button>
        </div>
      </div>
    : <Button size="small" variant="secondary" disabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onClick={() => setConfirming(id)}>{label}</Button>;
  if (view) return <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="xl" hideCloseButton
    className="max-h-[88dvh]" bodyClassName="space-y-4"
    title={title}
    description={<span className="break-all text-caption-1-regular text-text-tertiary">{repoPath}</span>}
    footer={<>
      <Button variant="secondary" disabled={Boolean(sending)} onClick={() => { setView(null); setError(''); setFailure(null); }}>{t('git.backToMenu')}</Button>
      <Button variant="secondary" disabled={Boolean(sending)} onClick={() => void (isPrView ? prDirect(view) : direct(view))}>{t('git.refreshStatus')}</Button>
      <Button onClick={() => onOpenChange(false)}>{t('controls.close')}</Button>
    </>}>
        <p className="text-caption-1-regular text-text-secondary">{isPrView
          ? t('git.execViaGithubApi', { detail: pr ? ` · ${pr.branch || t('git.noCommitDetached')}` : '' })
          : t('git.execDirectGit', { detail: snapshot ? ` · ${snapshot.currentBranch || t('git.noCommitDetached')}${snapshot.dirty ? ` · ${t('git.dirtyChanges')}` : ''}` : '' })}</p>
        {failure ? <Button size="small" variant="secondary" disabled={unavailable || Boolean(sending)} onClick={() => void send(failure.id, true)}>{t('git.handToAgent')}</Button> : null}
        {sending ? <div role="status" className="flex items-center gap-2 text-body-regular text-text-secondary"><Spinner size="sm" />{t('git.processing')}</div> : null}
        {output ? <pre role="status" className="whitespace-pre-wrap break-all rounded-2xl bg-background-secondary-default p-3 font-mono text-caption-1-regular text-text-primary">{output}</pre> : null}
        {isPrView ? <div className="space-y-3">
          {pr?.initialized && !prItem ? <div className="space-y-2">
            <p className="text-body-regular text-text-primary">{pr.branch ? t('git.noPrOnBranch', { branch: pr.branch }) : t('git.noPrDetached')}</p>
            <Button size="small" variant="secondary" disabled={writingBlocked || Boolean(sending)} onClick={() => choose('create-pr')}>{t('git.createPrTitle')}</Button>
          </div> : null}
          {prItem ? <div className={cx(GROUP_CARD, 'space-y-2')}>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-all text-body-medium text-text-primary">#{prItem.number} {prItem.title}</p>
              <ButtonLink href={prUrl || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!prUrl || undefined}
                variant="secondary" size="small" trailingIcon={RiExternalLinkLine}
                className={cx('shrink-0', !prUrl && 'pointer-events-none opacity-50')}>{t('git.open')}</ButtonLink>
            </div>
            <p className="break-all text-caption-1-regular text-text-secondary">{prItem.headRef} → {prItem.baseRef}{prItem.draft ? ` · ${t('git.draft')}` : ''}</p>
            <p className="text-caption-1-regular text-text-secondary">{prItem.state === 'merged' ? t('git.prStateMerged') : prItem.state === 'closed' ? t('git.prStateClosed') : t('git.prStateOpen')}
              {' · '}{t('git.prChecksLine', { passing: prItem.checks.passing, failing: prItem.checks.failing, pending: prItem.checks.pending, approved: prItem.reviews.approved, changes: prItem.reviews.changesRequested, comments: prItem.reviews.commented })}</p>
            <p className="text-caption-1-regular text-text-secondary">{t('git.mergeStatus', { status: prItem.mergeable === 'unknown' ? t('git.mergeStateUnknown') : prItem.mergeable === 'mergeable' ? t('git.mergeable') : t('git.unmergeable', { detail: prMergeStateLabelKeys[prItem.mergeState] ? `(${t(prMergeStateLabelKeys[prItem.mergeState])})` : '' }) })}
              {prItem.autoMergeMethod ? ` · ${t('git.autoMergeOn', { method: prMethodLabelKeys[prItem.autoMergeMethod as GitPullRequestMethod] ? t(prMethodLabelKeys[prItem.autoMergeMethod as GitPullRequestMethod]) : prItem.autoMergeMethod })}` : ''}</p>
          </div> : null}
          {prItem?.state === 'open' ? <div className="flex flex-wrap gap-2">
            {prItem.draft
              ? prConfirm('ready-pr', t('git.readyPrTitle'), { action: 'ready-pr' }, { hint: t('git.readyPrHint', { number: prItem.number }) })
              : prConfirm('draft-pr', t('git.draftPrTitle'), { action: 'draft-pr' }, { hint: t('git.draftPrHint', { number: prItem.number }) })}
            {prConfirm('close-pr', t('git.closePrTitle'), { action: 'close-pr' }, { danger: true, hint: t('git.closePrHint', { number: prItem.number }) })}
          </div> : null}
          {prItem?.state === 'closed' ? prConfirm('reopen-pr', t('git.reopenPr'), { action: 'reopen-pr' }, { hint: t('git.reopenPrHint', { number: prItem.number }) }) : null}
          {prItem?.state === 'open' ? <div className={cx(GROUP_CARD, 'space-y-2')}>
            <p className="text-body-medium text-text-primary">{t('git.merge')}</p>
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
          <p className="text-body-regular text-text-secondary">{t('git.createPrHint')}</p>
          <Input isRequired value={prRepository} onChange={setPrRepository} label={t('git.repoLabel')} placeholder={t('git.repoPlaceholder')} />
          <Input isRequired value={prBase} onChange={setPrBase} label={t('git.baseBranch')} placeholder={t('git.baseBranchPlaceholder')} />
          <Input isRequired value={prTitle} onChange={setPrTitle} label={t('git.prTitleLabel')} placeholder={t('git.prTitlePlaceholder')} maxLength={256} />
          <Textarea value={prBody} onChange={setPrBody} label={t('git.prBodyLabel')} rows={5} placeholder={t('git.prBodyPlaceholder')} />
          <Checkbox isSelected={prDraft} onChange={setPrDraft}>{t('git.createAsDraft')}</Checkbox>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={writingBlocked || Boolean(sending) || outcomeUnknown.current || Boolean(output) || !snapshot?.initialized || !snapshot.currentBranch || !prTitle.trim() || !prBase.trim() || !prRepository.trim()}>{t('git.createPrTitle')}</Button>
            {output ? <Button variant="secondary" disabled={unavailable || Boolean(sending)} onClick={() => void send('view-pr')}>{t('git.letAgentViewPr')}</Button> : null}
          </div>
        </form> : null}
        {isBranchForm ? <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          if (!branchName.trim() || (view === 'create-worktree' && !worktreePath)) return;
          void direct(view, view === 'create-worktree'
            ? { action: 'create-worktree', path: worktreePath, branchName: worktreeBranch, ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}) }
            : { action: 'create-branch', branchName: branchName.trim(), ...(startPoint.trim() ? { startPoint: startPoint.trim() } : {}) });
        }}>
          <Input isRequired value={branchName} onChange={setBranchName} label={view === 'create-worktree' ? t('git.worktreeName') : t('git.newBranchName')} placeholder={view === 'create-worktree' ? t('git.worktreeNamePlaceholder') : 'codex/my-task'} />
          <Input value={startPoint} onChange={setStartPoint} label={t('git.startPoint')} placeholder={t('git.startPointPlaceholder')} />
          {view === 'create-worktree' ? <p className="break-all text-caption-1-regular text-text-secondary">{t('git.worktreeDerived', { branch: worktreeBranch || 'todex/…', path: worktreePath || `${worktreeBase}/todex/…` })}</p> : <p className="text-caption-1-regular text-text-secondary">{t('git.branchStays')}</p>}
          <Button type="submit" disabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || !snapshot?.initialized || (view === 'create-worktree' && !worktreePath)}>{title}</Button>
        </form> : null}
        {(view === 'list-branches' || view === 'switch-branch') && snapshot ? <div className="space-y-2">
          {snapshot.branches.length === 0 ? <p className="text-body-regular text-text-secondary">{t('git.noBranches')}</p> : snapshot.branches.map(branch => <div key={branch.name} className={cx(GROUP_CARD, 'flex items-center justify-between gap-3')}>
            <div className="min-w-0"><p className="break-all text-body-regular text-text-primary">{branch.name}{branch.current ? ` · ${t('git.currentBranch')}` : ''}{branch.remote ? ` · ${t('git.remoteBranch')}` : ''}</p>{branch.worktreePath ? <p className="break-all text-caption-1-regular text-text-secondary">{branch.worktreePath}</p> : null}</div>
            {view === 'switch-branch' && !branch.remote ? <Button size="small" variant="secondary" disabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || snapshot.dirty || branch.current || Boolean(branch.worktreePath)} onClick={() => void direct(view, { action: 'switch-branch', branchName: branch.name })}>{t('git.switch')}</Button> : null}
          </div>)}
        </div> : null}
        {(view === 'list-worktrees' || view === 'switch-worktree' || view === 'manage-worktrees') && snapshot ? <div className="space-y-3">
          {view === 'switch-worktree' ? <p className="text-caption-1-regular text-text-secondary">{t('git.switchWorktreeHint')}</p> : null}
          {snapshot.worktrees.map(tree => <div key={tree.path} className={cx(GROUP_CARD, 'space-y-2')}>
            <p className="break-all text-body-regular text-text-primary">{tree.branch || t('git.detachedHead')}{tree.current ? ` · ${t('git.currentBranch')}` : ''}{tree.main ? ` · ${t('git.mainWorktree')}` : ''}</p><p className="break-all text-caption-1-regular text-text-secondary">{tree.path}</p>
            <p className="text-caption-1-regular text-text-secondary">{!tree.accessible ? t('git.worktreeInaccessible') : tree.dirty ? t('git.dirtyChanges') : t('git.mergeStateClean')}{tree.locked ? ` · ${t('git.locked')}` : ''}</p>
            {view === 'switch-worktree' ? <Button size="small" variant="secondary" disabled={Boolean(sending) || tree.current || !tree.accessible} onClick={() => {
              if (conversation && session.openGitWorktree(tree.path, conversation.id)) onOpenChange(false);
            }}>{t('git.openWorktree')}</Button> : null}
            {view === 'manage-worktrees' ? removePath === tree.path ? <div className="space-y-2"><p className="text-body-regular text-text-primary">{t('git.removeWorktreeConfirm')}</p><div className="flex gap-2"><Button size="small" variant="danger" disabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown)} onClick={() => void direct(view, { action: 'remove-worktree', path: tree.path })}>{t('git.confirmRemove')}</Button><Button size="small" variant="secondary" onClick={() => setRemovePath('')}>{t('common.cancel')}</Button></div></div> : <Button size="small" variant="secondary" disabled={writingBlocked || Boolean(sending) || Boolean(failure?.unknown) || tree.main || tree.current || tree.dirty || tree.locked || !tree.accessible} onClick={() => setRemovePath(tree.path)}>{t('git.removeWorktree')}</Button> : null}
          </div>)}
        </div> : null}
  </Modal>;

  const disabledKeys = allActions.filter(action => unavailable || sending || (writingBlocked && (action.id === 'init' || action.id === 'push'))).map(action => action.id);
  const changedFiles = overview.status.data?.changedFiles;
  const selectedRepo = git.repoOptions.find(repo => repo.path === repoPath);
  // One fixed height for both tabs; the scrolling area of the active tab takes what the header leaves.
  return <Modal isOpen={isOpen} onOpenChange={onOpenChange} aria-label={t('git.operations')} hideCloseButton size="xl"
    className="h-[min(46rem,88dvh)] max-h-[88dvh]" bodyClassName="flex flex-col overflow-y-hidden p-0">
    <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-3">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-title-3-semibold text-text-primary"><RiGithubLine aria-hidden className="size-5 text-foreground-icon-primary" />{t('git.operations')}</h2>
        <p className="mt-1 truncate text-body-regular text-text-primary" title={workspace?.path}>{workspace?.name || t('git.noWorkspace')}</p>
        {workspace?.path ? <p className="mt-0.5 truncate text-caption-1-regular text-text-tertiary" title={workspace.path}>{workspace.path}</p> : null}
        {workspace && git.repoOptions.length > 1 ? <Select
          aria-label={t('git.selectRepository')}
          className="mt-2 w-full"
          popoverClassName="w-(--trigger-width)"
          selectedKey={repoPath}
          onSelectionChange={chooseRepo}
          renderValue={() => selectedRepo ? `${selectedRepo.name}${selectedRepo.uninitialized ? ` · ${t('git.repoUninitialized')}` : selectedRepo.containing ? ` · ${t('git.containingRepo')}` : ''}` : repoPath}
        >
          {git.repoOptions.map(repo => <SelectItem key={repo.path} id={repo.path} textValue={`${repo.name} ${repo.branch} ${repo.path}`}>
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{repo.name}{repo.uninitialized ? ` · ${t('git.repoUninitialized')}` : repo.containing ? ` · ${t('git.containingRepo')}` : ''}</span>
              <span className="truncate text-caption-1-regular text-text-secondary">{repo.uninitialized || repo.error
                ? repo.error || repo.path
                : `${repo.branch || t('git.noCommitDetached')} · ${t('git.changedFiles', { count: repo.changedFiles })} +${repo.additions} −${repo.deletions}`}</span>
            </div>
          </SelectItem>)}
        </Select> : null}
      </div>
      <ModalCloseButton label={t('git.closeOperations')} onPress={() => onOpenChange(false)} />
    </div>
    <Tabs selectedKey={tab} onSelectionChange={key => setTab(key === 'operations' ? 'operations' : 'status')} className="min-h-0 flex-1 gap-0">
      <div className="shrink-0 px-6 pb-2">
        <TabList aria-label={t('git.pagesLabel')}>
          <Tab id="status" icon={RiPulseLine} count={changedFiles ? <span className="tabular-nums">{changedFiles}</span> : undefined}>{t('git.tabStatus')}</Tab>
          <Tab id="operations" icon={RiFlashlightLine}>{t('git.tabOperations')}</Tab>
        </TabList>
      </div>
      <TabPanel id="status" className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1" contentClassName="px-6 pb-4" surface="full">
          <GitStatusOverview key={repoPath} overview={overview} files={git.files} filesTruncated={git.filesTruncated}
            onJump={group => { setTab('operations'); setJumpGroup(group); }} />
        </ScrollArea>
      </TabPanel>
      <TabPanel id="operations" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 px-6 pb-2 text-caption-1-regular text-text-secondary">
          <ProviderIcon provider={provider} className="size-4" />
          <span className="truncate">{conversation ? t('git.sendTo', { provider: providerDisplayName(provider), title: conversation.title }) : t('git.pickAgent')}</span>
        </div>
        {overview.status.data?.initialized ? <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-6 pb-2">
          <Tag><RiGitBranchLine aria-hidden className="size-3" /><span className="font-mono">{overview.status.data.branch || t('git.detachedHead')}</span></Tag>
          {overview.status.data.changedFiles
            ? <Tag color="yellow">{t('git.changedFiles', { count: overview.status.data.changedFiles })}</Tag>
            : <Tag color="lime">{t('git.cleanTree')}</Tag>}
          {overview.status.data.ahead ? <Tag color="yellow"><RiArrowUpLine aria-hidden className="size-3" />{overview.status.data.ahead}</Tag> : null}
          {overview.pullRequest.data?.pullRequest ? <Tag color="blue"><RiGitPullRequestLine aria-hidden className="size-3" />#{overview.pullRequest.data.pullRequest.number}</Tag> : null}
        </div> : null}
        <Autocomplete filter={contains}>
          <SearchField aria-label={t('git.searchOps')} className="group/search relative mx-6 mb-1 shrink-0">
            <InputBase leadingIcon={RiSearchLine} placeholder={t('git.searchPlaceholder')} className="pe-7 [&::-webkit-search-cancel-button]:appearance-none" />
            <AriaButton aria-label={t('git.clearSearch')} className={cx(
              'absolute end-2 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary',
              'outline-none transition-colors duration-150 ease hover:bg-background-tertiary-hover hover:text-foreground-icon-primary',
              'data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring group-data-[empty]/search:hidden',
            )}>
              <RiCloseLine aria-hidden className="size-4" />
            </AriaButton>
          </SearchField>
          <ScrollArea className="min-h-0 flex-1" contentClassName="px-4 pt-1 pb-4" viewportRef={opsListRef} surface="full">
            <Menu aria-label={t('git.opsList')} disabledKeys={disabledKeys}
              onAction={key => { const action = allActions.find(item => item.id === String(key)); if (action) choose(action.id); }}
              renderEmptyState={() => <p className="px-2 py-8 text-center text-body-regular text-text-tertiary">{t('git.noMatch')}</p>}>
              {gitAgentActionGroups.map(group => {
                const GroupIcon = groupIcons[group.id as keyof typeof groupIcons] || RiGitBranchLine;
                return <MenuSection key={group.id} id={group.id} title={group.title} className="pb-2">
                  {group.actions.map(action => {
                    const Icon = group.id.startsWith('pr-') || group.id === 'pull-requests' ? RiGitPullRequestLine
                      : action.id === 'push' || action.id === 'commit-and-push' ? RiUploadCloud2Line : GroupIcon;
                    return <AriaMenuItem key={action.id} id={action.id} textValue={`${action.title} ${action.description} ${action.id}`}
                      className={({ isFocused, isHovered, isDisabled }) => cx(
                        'group flex min-h-14 cursor-pointer items-center gap-3 rounded-2lg px-3 py-2 text-start outline-none transition-colors duration-150 ease',
                        (isFocused || isHovered) && !isDisabled && MENU_ITEM_ACTIVE,
                        isDisabled && 'cursor-not-allowed opacity-50',
                      )}>
                      <Icon aria-hidden className="size-[18px] shrink-0 text-foreground-icon-secondary" />
                      <div className="min-w-0 flex-1">
                        <span className="block text-body-medium text-text-primary">{action.title}</span>
                        <span className="block text-caption-1-regular text-text-secondary">{action.description} · {action.mode === 'agent' ? 'Agent' : t('git.modeDirect')}</span>
                      </div>
                      {sending === action.id ? <Spinner size="sm" /> : <RiArrowRightLine aria-hidden className="size-4 shrink-0 text-foreground-icon-tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-data-[focused]:opacity-100" />}
                    </AriaMenuItem>;
                  })}
                </MenuSection>;
              })}
            </Menu>
          </ScrollArea>
        </Autocomplete>
      </TabPanel>
    </Tabs>
  </Modal>;
}

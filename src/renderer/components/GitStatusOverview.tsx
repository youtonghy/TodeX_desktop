import { useState, type ReactNode } from 'react';
import { Chip } from '@/components/base/badges/chip';
import { Spinner } from '@/components/ui/spinner';
import { cx } from '@/utils/cx';
import {
  RiArrowDownLine, RiArrowDownSLine, RiArrowRightSLine, RiArrowUpLine, RiArrowUpSLine, RiCheckLine,
  RiExternalLinkLine, RiFileEditLine, RiFolderAddLine, RiGitBranchLine, RiGitCommitLine, RiGitPullRequestLine,
  RiLockLine, RiStackLine,
} from '@remixicon/react';
import { externalHttpUrl, type GitLogCommit, type GitPullRequest, type GitRepositoryFile, type GitStatusSummary } from '../lib/gitWorkspace';
import { GIT_LOG_PAGE_SIZE, type GitOverview } from '../session/useGitOverview';
import { useLocale, useT, type MessageKey } from '../i18n';

type ChipColor = 'neutral' | 'blue' | 'lime' | 'yellow' | 'rose';
type Props = {
  overview: GitOverview;
  files: readonly GitRepositoryFile[];
  filesTruncated: boolean;
  /** Opens the actions tab at the given action group. */
  onJump: (groupId: string) => void;
};

const VISIBLE_FILES = 5;
const prMergeStateKeys: Record<string, MessageKey> = { clean: 'git.mergeStateClean', dirty: 'git.mergeStateDirty', blocked: 'git.mergeStateBlocked',
  behind: 'git.mergeStateBehind', unstable: 'git.mergeStateUnstable', unknown: 'git.mergeStateUnknown' };

/** Porcelain v1 `XY` status → one-letter badge. */
function fileBadge(status: string): { code: string; key: MessageKey; color: ChipColor } {
  const xy = status.padEnd(2, ' ');
  if (xy === '??') return { code: 'U', key: 'git.fileUntracked', color: 'lime' };
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return { code: '!', key: 'git.fileConflicted', color: 'rose' };
  const change = xy[0] !== ' ' ? xy[0] : xy[1];
  if (change === 'D') return { code: 'D', key: 'git.fileDeleted', color: 'rose' };
  if (change === 'A' || change === 'C') return { code: 'A', key: 'git.fileAdded', color: 'lime' };
  if (change === 'R') return { code: 'R', key: 'git.fileRenamed', color: 'blue' };
  return { code: 'M', key: 'git.fileModified', color: 'yellow' };
}

const relativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60],
];
function relativeTime(seconds: number, locale: string) {
  const diff = seconds - Date.now() / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of relativeUnits) {
    if (Math.abs(diff) >= size) return format.format(Math.round(diff / size), unit);
  }
  return format.format(Math.round(diff), 'second');
}

/** Small chip with an optional leading glyph. */
function Tag({ color = 'neutral', className, children, ...props }: { color?: ChipColor; className?: string; children: ReactNode; 'aria-label'?: string }) {
  return <Chip variant="caption" color={color} className={cx('gap-1 px-1.5 py-0.5', className)} {...props}>{children}</Chip>;
}

/** Quiet text action: the BoardUI row-button recipe at caption size. */
const QUIET_ACTION = cx(
  'inline-flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-lg px-2 text-caption-1-medium',
  'outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

function Section({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="space-y-2 border-t border-separator-border py-3 first:border-t-0 first:pt-1">
    <div className="flex min-h-7 items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-caption-1-semibold text-text-secondary">{icon}{title}</h3>
      {action}
    </div>
    {children}
  </section>;
}

function JumpButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <button type="button" className={cx(QUIET_ACTION, 'text-text-secondary hover:text-text-primary')} onClick={onPress}>
    {label}<RiArrowRightSLine aria-hidden className="size-3.5" />
  </button>;
}

function SectionError({ error }: { error: string }) {
  const t = useT();
  return <p className="break-all text-caption-1-regular text-status-yellow-text">{t('git.sectionReadFailed', { error })}</p>;
}

function ChangesSection({ status, files, filesTruncated }: { status: GitStatusSummary; files: readonly GitRepositoryFile[]; filesTruncated: boolean }) {
  const t = useT();
  if (status.changedFiles === 0) {
    return <p className="flex items-baseline gap-2"><span className="text-body-semibold text-text-primary">{t('git.cleanTree')}</span><span className="text-caption-1-regular text-text-secondary">{t('git.cleanTreeHint')}</span></p>;
  }
  const total = status.additions + status.deletions;
  const hidden = Math.max(0, files.length - VISIBLE_FILES);
  return <>
    <p className="flex flex-wrap items-baseline gap-x-2.5 tabular-nums">
      <span className="text-body-semibold text-text-primary">{t('git.changesHeadline', { count: status.changedFiles })}</span>
      <span className="text-caption-1-semibold text-status-lime-text">+{status.additions}{status.statsTruncated ? '…' : ''}</span>
      <span className="text-caption-1-semibold text-text-error-primary">−{status.deletions}{status.statsTruncated ? '…' : ''}</span>
    </p>
    {total > 0 ? <div aria-hidden className="flex h-1 overflow-hidden rounded-full bg-chart-track">
      <span className="bg-chart-7" style={{ flex: status.additions }} />
      <span className="bg-foreground-icon-error" style={{ flex: status.deletions }} />
    </div> : null}
    {files.length > 0 ? <ul className="space-y-0.5">
      {files.slice(0, VISIBLE_FILES).map(file => {
        const badge = fileBadge(file.status);
        const slash = file.path.lastIndexOf('/');
        return <li key={file.path} className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-caption-1-regular text-text-primary" title={file.path}>
          <Tag color={badge.color} className="w-5 shrink-0 px-0 font-mono" aria-label={t(badge.key)}>{badge.code}</Tag>
          {/* rtl keeps the file name visible when a long directory path is truncated */}
          <span className="min-w-0 flex-1 truncate font-mono [direction:rtl] text-left"><bdi>
            {slash >= 0 ? file.path.slice(0, slash + 1) : ''}<span className="font-semibold">{file.path.slice(slash + 1)}</span>
          </bdi></span>
          <span className="flex shrink-0 gap-1.5 font-mono tabular-nums">
            {file.additions ? <span className="text-status-lime-text">+{file.additions}</span> : null}
            {file.deletions ? <span className="text-text-error-primary">−{file.deletions}</span> : null}
          </span>
        </li>;
      })}
    </ul> : null}
    {hidden > 0 || filesTruncated ? <p className="px-1.5 text-caption-1-regular text-text-tertiary">{t('git.moreFiles', { count: hidden })}{filesTruncated ? t('git.partialStats') : ''}</p> : null}
  </>;
}

function RemoteChips({ status }: { status: GitStatusSummary }) {
  const t = useT();
  // Older backends omit these fields entirely; say nothing rather than guess.
  if (status.ahead === undefined) return null;
  const chips: ReactNode[] = [];
  if (status.upstream) {
    if (status.ahead) chips.push(<Tag key="ahead" color="yellow"><RiArrowUpLine aria-hidden className="size-3" />{t('git.aheadOfUpstream', { count: status.ahead })}</Tag>);
    if (status.behind) chips.push(<Tag key="behind" color="blue"><RiArrowDownLine aria-hidden className="size-3" />{t('git.behindUpstream', { count: status.behind })}</Tag>);
    if (!status.ahead && !status.behind) chips.push(<Tag key="synced" color="lime"><RiCheckLine aria-hidden className="size-3" />{t('git.syncedWith', { upstream: status.upstream })}</Tag>);
  } else if (status.ahead !== null) {
    chips.push(<Tag key="none">{t('git.noUpstream')}</Tag>);
    if (status.ahead > 0) chips.push(<Tag key="unpushed" color="yellow"><RiArrowUpLine aria-hidden className="size-3" />{t('git.notOnRemote', { count: status.ahead })}</Tag>);
  } else if (status.branch !== null) {
    chips.push(<Tag key="noremote">{t('git.noRemote')}</Tag>);
  }
  if (!chips.length) return null;
  return <div className="flex items-center gap-3 text-caption-1-regular"><span className="text-text-secondary">{t('git.remoteLabel')}</span><div className="flex flex-wrap gap-1.5">{chips}</div></div>;
}

function CommitRow({ commit, head, last }: { commit: GitLogCommit; head: boolean; last: boolean }) {
  const t = useT();
  const locale = useLocale();
  const unpushed = commit.pushed === false;
  return <li className="relative flex items-start gap-2.5 rounded-lg px-1.5 py-1">
    {last ? null : <span aria-hidden className="absolute top-5 -bottom-1.5 left-[0.9rem] w-0.5 rounded-full bg-background-tertiary-default" />}
    <span aria-hidden className={cx('relative mt-1 size-3.5 shrink-0 rounded-full border-2', unpushed ? 'border-chart-8 bg-status-yellow-background' : 'border-foreground-icon-tertiary bg-background-primary-default')} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-body-regular text-text-primary" title={commit.subject}>{commit.subject}</p>
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption-1-regular text-text-secondary">
        <span className="font-mono text-text-accent" title={commit.sha}>{commit.sha.slice(0, 7)}</span>
        <span className="truncate" title={new Date(commit.authoredAt * 1000).toLocaleString(locale)}>{commit.authorName} · {relativeTime(commit.authoredAt, locale)}</span>
        {unpushed ? <Tag color="yellow">{t('git.unpushed')}</Tag> : null}
        {head ? <Tag>HEAD</Tag> : null}
      </p>
    </div>
  </li>;
}

function CommitHistory({ overview }: { overview: GitOverview }) {
  const t = useT();
  const { commits, loadMoreCommits } = overview;
  // Latest commit by default; each expand reveals GIT_LOG_PAGE_SIZE more. Collapsing keeps the
  // loaded pages so re-expanding does not refetch.
  const [shown, setShown] = useState(1);
  const visible = commits.items.slice(0, shown);
  const canShowMore = commits.items.length > shown || commits.hasMore;
  const more = async () => {
    const target = shown + GIT_LOG_PAGE_SIZE;
    if (commits.items.length < target && commits.hasMore) await loadMoreCommits();
    setShown(target);
  };
  if (!commits.items.length) {
    if (commits.unsupported) return <p className="text-caption-1-regular text-text-tertiary">{t('git.commitsUnsupported')}</p>;
    if (commits.loading) return <Spinner size="sm" />;
    if (commits.error) return <SectionError error={commits.error} />;
    return <p className="text-caption-1-regular text-text-tertiary">{t('git.noCommits')}</p>;
  }
  const nextCount = Math.min(GIT_LOG_PAGE_SIZE, commits.hasMore ? GIT_LOG_PAGE_SIZE : commits.items.length - shown);
  return <div>
    <ol aria-label={t('git.commitHistory')}>
      {visible.map((commit, index) => <CommitRow key={commit.sha} commit={commit} head={index === 0} last={index === visible.length - 1} />)}
    </ol>
    {commits.error ? <SectionError error={commits.error} /> : null}
    {canShowMore || shown > 1 ? <div className="flex items-center gap-1 pt-1">
      {canShowMore ? <button type="button" className={cx(QUIET_ACTION, 'text-text-accent')} disabled={commits.loading} aria-busy={commits.loading || undefined} onClick={() => void more()}>
        {commits.loading ? <Spinner size="sm" className="text-current" /> : <RiArrowDownSLine aria-hidden className="size-4" />}{t('git.showEarlierCommits', { count: nextCount })}
      </button> : null}
      {shown > 1 ? <button type="button" className={cx(QUIET_ACTION, 'text-text-secondary hover:text-text-primary')} onClick={() => setShown(1)}>
        <RiArrowUpSLine aria-hidden className="size-4" />{t('git.collapse')}
      </button> : null}
    </div> : null}
  </div>;
}

function PullRequestCard({ pr }: { pr: GitPullRequest }) {
  const t = useT();
  const url = externalHttpUrl(pr.url);
  const state = pr.draft ? t('git.draft') : pr.state === 'merged' ? t('git.prStateMerged') : pr.state === 'closed' ? t('git.prStateClosed') : t('git.prStateOpen');
  const iconColor = pr.state === 'merged' ? 'text-text-accent' : pr.state === 'closed' ? 'text-foreground-icon-error' : 'text-status-lime-text';
  const merge = pr.mergeable === 'mergeable' ? <Tag color="lime">{t('git.mergeable')}</Tag>
    : pr.mergeable === 'unknown' ? <Tag>{t('git.mergeStateUnknown')}</Tag>
    : <Tag color="rose">{t('git.unmergeable', { detail: prMergeStateKeys[pr.mergeState] ? ` · ${t(prMergeStateKeys[pr.mergeState])}` : '' })}</Tag>;
  const checks = [
    t('git.checksPassing', { count: pr.checks.passing }),
    pr.checks.failing ? t('git.checksFailing', { count: pr.checks.failing }) : '',
    pr.checks.pending ? t('git.checksPending', { count: pr.checks.pending }) : '',
  ].filter(Boolean).join(' · ');
  return <a href={url || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!url || undefined}
    aria-label={t('git.openPrInBrowser', { number: pr.number, title: pr.title })}
    className={cx(
      'block w-full space-y-1.5 rounded-2xl border border-transparent bg-background-secondary-default p-3 text-text-primary no-underline',
      'outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring',
      url ? 'cursor-pointer hover:border-border-button-hover' : 'cursor-default',
    )}>
    <span className="flex min-w-0 items-center gap-1.5 text-body-medium">
      <RiGitPullRequestLine aria-hidden className={cx('size-4 shrink-0', iconColor)} />
      <span className="shrink-0 font-mono">#{pr.number}</span>
      <span className="min-w-0 flex-1 truncate">{pr.title}</span>
      {url ? <span className="flex shrink-0 items-center gap-1 text-caption-1-regular text-text-secondary"><RiExternalLinkLine aria-hidden className="size-3.5" />{t('git.openInBrowser')}</span> : null}
    </span>
    <span className="block truncate font-mono text-caption-1-regular text-text-secondary">{pr.headRef} → {pr.baseRef}</span>
    <span className="flex flex-wrap gap-1.5">
      <Tag color="blue">{state}</Tag>
      {merge}
      <Tag color={pr.checks.failing ? 'rose' : pr.checks.pending ? 'yellow' : 'lime'}>{checks}</Tag>
      <Tag>{t('git.reviewsSummary', { approved: pr.reviews.approved, changes: pr.reviews.changesRequested, comments: pr.reviews.commented })}</Tag>
    </span>
  </a>;
}

/** Read-only first tab of the Git menu: changes, commits, PR, branches and worktrees. */
export function GitStatusOverview({ overview, files, filesTruncated, onJump }: Props) {
  const t = useT();
  const status = overview.status.data;
  if (!status) {
    return <div className="flex min-h-40 items-center justify-center py-8">
      {overview.status.error ? <SectionError error={overview.status.error} /> : <Spinner size="sm" />}
    </div>;
  }
  if (!status.initialized) {
    return <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-body-regular text-text-secondary">
      <RiFolderAddLine aria-hidden className="size-8 text-foreground-icon-tertiary" />
      <p className="text-body-semibold text-text-primary">{t('git.notRepoTitle')}</p>
      <p>{t('git.notRepoHint')}</p>
    </div>;
  }
  const snapshot = overview.workspace.data;
  const prSnapshot = overview.pullRequest.data;
  const pr = prSnapshot?.pullRequest ?? null;
  const localBranches = snapshot?.branches.filter(branch => !branch.remote).length ?? 0;
  const remoteBranches = snapshot?.branches.filter(branch => branch.remote).length ?? 0;
  const worktrees = snapshot?.worktrees ?? [];
  return <div>
    <Section icon={<RiFileEditLine className="size-3.5" />} title={t('git.sectionChanges')}
      action={<JumpButton label={t('git.jumpCommitActions')} onPress={() => onJump('repository')} />}>
      <ChangesSection status={status} files={files} filesTruncated={filesTruncated} />
    </Section>
    <Section icon={<RiGitCommitLine className="size-3.5" />} title={t('git.sectionCommits')}
      action={<JumpButton label={t('git.jumpPushActions')} onPress={() => onJump('repository')} />}>
      <RemoteChips status={status} />
      <CommitHistory overview={overview} />
    </Section>
    <Section icon={<RiGitPullRequestLine className="size-3.5" />} title={t('git.sectionPullRequest')}
      action={<JumpButton label={pr ? t('git.jumpPrActions') : t('git.createPrTitle')} onPress={() => onJump('pull-requests')} />}>
      {pr ? <PullRequestCard pr={pr} />
        : overview.pullRequest.error ? <SectionError error={overview.pullRequest.error} />
        : prSnapshot ? <p className="text-caption-1-regular text-text-tertiary">{prSnapshot.branch ? t('git.noPrOnBranch', { branch: prSnapshot.branch }) : t('git.noPrDetached')}</p>
        : <Spinner size="sm" />}
    </Section>
    <Section icon={<RiGitBranchLine className="size-3.5" />} title={t('git.sectionBranches')}
      action={<JumpButton label={t('git.jumpBranchActions')} onPress={() => onJump('branches')} />}>
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-mono text-body-semibold text-text-primary">{status.branch || t('git.noCommitDetached')}</span>
        {status.worktreeKind ? <Tag color={status.worktreeKind === 'linked' ? 'blue' : 'neutral'}>
          {status.worktreeKind === 'linked' ? t('git.linkedWorktree') : t('git.mainWorktree')}
        </Tag> : null}
        {snapshot ? <span className="text-caption-1-regular text-text-secondary">{t('git.branchCounts', { local: localBranches, remote: remoteBranches, worktrees: worktrees.length })}</span> : null}
      </p>
      {overview.workspace.error ? <SectionError error={overview.workspace.error} />
        : !snapshot ? <Spinner size="sm" />
        : worktrees.length > 1 ? <ul className="space-y-0.5">
          {worktrees.map(tree => <li key={tree.path} className={cx('flex items-start gap-2 rounded-lg px-2 py-1.5', tree.current && 'bg-pill-tab-blue-selected-background')}>
            <RiStackLine aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground-icon-secondary" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-1">
                <span className="me-1 truncate font-mono text-caption-1-regular text-text-primary">{tree.branch || t('git.detachedHead')}</span>
                {tree.main ? <Tag>{t('git.mainWorktree')}</Tag> : null}
                {tree.current ? <Tag color="blue">{t('git.currentBranch')}</Tag> : null}
                {tree.dirty ? <Tag color="yellow">{t('git.dirtyChanges')}</Tag> : null}
                {tree.locked ? <Tag><RiLockLine aria-hidden className="size-3" />{t('git.locked')}</Tag> : null}
                {!tree.accessible ? <Tag color="rose">{t('git.worktreeInaccessible')}</Tag> : null}
              </div>
              <p className="truncate font-mono text-caption-1-regular text-text-tertiary" title={tree.path}>{tree.path}</p>
            </div>
          </li>)}
        </ul> : null}
    </Section>
  </div>;
}

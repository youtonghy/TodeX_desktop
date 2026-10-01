import { useState, type ReactNode } from 'react';
import { Button, Chip, Link, Spinner } from '@heroui/react';
import {
  RiArrowDownLine, RiArrowDownSLine, RiArrowRightSLine, RiArrowUpLine, RiArrowUpSLine, RiCheckLine,
  RiExternalLinkLine, RiFileEditLine, RiFolderAddLine, RiGitBranchLine, RiGitCommitLine, RiGitPullRequestLine,
  RiLockLine, RiStackLine,
} from '@remixicon/react';
import { externalHttpUrl, type GitLogCommit, type GitPullRequest, type GitRepositoryFile, type GitStatusSummary } from '../lib/gitWorkspace';
import { GIT_LOG_PAGE_SIZE, type GitOverview } from '../session/useGitOverview';
import { useLocale, useT, type MessageKey } from '../i18n';

type ChipColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';
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
  if (xy === '??') return { code: 'U', key: 'git.fileUntracked', color: 'success' };
  if (xy.includes('U') || xy === 'AA' || xy === 'DD') return { code: '!', key: 'git.fileConflicted', color: 'danger' };
  const change = xy[0] !== ' ' ? xy[0] : xy[1];
  if (change === 'D') return { code: 'D', key: 'git.fileDeleted', color: 'danger' };
  if (change === 'A' || change === 'C') return { code: 'A', key: 'git.fileAdded', color: 'success' };
  if (change === 'R') return { code: 'R', key: 'git.fileRenamed', color: 'accent' };
  return { code: 'M', key: 'git.fileModified', color: 'warning' };
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

function Section({ icon, title, action, children }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="border-default space-y-2 border-t py-3 first:border-t-0 first:pt-1">
    <div className="flex min-h-7 items-center justify-between gap-2">
      <h3 className="text-muted flex items-center gap-1.5 text-xs font-semibold">{icon}{title}</h3>
      {action}
    </div>
    {children}
  </section>;
}

function JumpButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Button size="sm" variant="ghost" className="text-muted h-7 gap-0.5 px-2 text-xs" onPress={onPress}>
    {label}<RiArrowRightSLine className="size-3.5" />
  </Button>;
}

function SectionError({ error }: { error: string }) {
  const t = useT();
  return <p className="text-warning break-all text-xs">{t('git.sectionReadFailed', { error })}</p>;
}

function ChangesSection({ status, files, filesTruncated }: { status: GitStatusSummary; files: readonly GitRepositoryFile[]; filesTruncated: boolean }) {
  const t = useT();
  if (status.changedFiles === 0) {
    return <p className="flex items-baseline gap-2"><span className="text-sm font-semibold">{t('git.cleanTree')}</span><span className="text-muted text-xs">{t('git.cleanTreeHint')}</span></p>;
  }
  const total = status.additions + status.deletions;
  const hidden = Math.max(0, files.length - VISIBLE_FILES);
  return <>
    <p className="flex flex-wrap items-baseline gap-x-2.5 tabular-nums">
      <span className="text-sm font-semibold">{t('git.changesHeadline', { count: status.changedFiles })}</span>
      <span className="text-success text-xs font-semibold">+{status.additions}{status.statsTruncated ? '…' : ''}</span>
      <span className="text-danger text-xs font-semibold">−{status.deletions}{status.statsTruncated ? '…' : ''}</span>
    </p>
    {total > 0 ? <div aria-hidden className="bg-default flex h-1 overflow-hidden rounded-full">
      <span className="bg-success" style={{ flex: status.additions }} />
      <span className="bg-danger" style={{ flex: status.deletions }} />
    </div> : null}
    {files.length > 0 ? <ul className="space-y-0.5">
      {files.slice(0, VISIBLE_FILES).map(file => {
        const badge = fileBadge(file.status);
        const slash = file.path.lastIndexOf('/');
        return <li key={file.path} className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-xs" title={file.path}>
          <Chip size="sm" variant="soft" color={badge.color} className="w-5 shrink-0 justify-center px-0 font-mono" aria-label={t(badge.key)}>{badge.code}</Chip>
          {/* rtl keeps the file name visible when a long directory path is truncated */}
          <span className="min-w-0 flex-1 truncate font-mono [direction:rtl] text-left"><bdi>
            {slash >= 0 ? file.path.slice(0, slash + 1) : ''}<span className="font-semibold">{file.path.slice(slash + 1)}</span>
          </bdi></span>
          <span className="flex shrink-0 gap-1.5 font-mono tabular-nums">
            {file.additions ? <span className="text-success">+{file.additions}</span> : null}
            {file.deletions ? <span className="text-danger">−{file.deletions}</span> : null}
          </span>
        </li>;
      })}
    </ul> : null}
    {hidden > 0 || filesTruncated ? <p className="text-muted px-1.5 text-xs">{t('git.moreFiles', { count: hidden })}{filesTruncated ? t('git.partialStats') : ''}</p> : null}
  </>;
}

function RemoteChips({ status }: { status: GitStatusSummary }) {
  const t = useT();
  // Older backends omit these fields entirely; say nothing rather than guess.
  if (status.ahead === undefined) return null;
  const chips: ReactNode[] = [];
  if (status.upstream) {
    if (status.ahead) chips.push(<Chip key="ahead" size="sm" variant="soft" color="warning"><RiArrowUpLine className="size-3" />{t('git.aheadOfUpstream', { count: status.ahead })}</Chip>);
    if (status.behind) chips.push(<Chip key="behind" size="sm" variant="soft" color="accent"><RiArrowDownLine className="size-3" />{t('git.behindUpstream', { count: status.behind })}</Chip>);
    if (!status.ahead && !status.behind) chips.push(<Chip key="synced" size="sm" variant="soft" color="success"><RiCheckLine className="size-3" />{t('git.syncedWith', { upstream: status.upstream })}</Chip>);
  } else if (status.ahead !== null) {
    chips.push(<Chip key="none" size="sm" variant="soft">{t('git.noUpstream')}</Chip>);
    if (status.ahead > 0) chips.push(<Chip key="unpushed" size="sm" variant="soft" color="warning"><RiArrowUpLine className="size-3" />{t('git.notOnRemote', { count: status.ahead })}</Chip>);
  } else if (status.branch !== null) {
    chips.push(<Chip key="noremote" size="sm" variant="soft">{t('git.noRemote')}</Chip>);
  }
  if (!chips.length) return null;
  return <div className="flex items-center gap-3 text-xs"><span className="text-muted">{t('git.remoteLabel')}</span><div className="flex flex-wrap gap-1.5">{chips}</div></div>;
}

function CommitRow({ commit, head, last }: { commit: GitLogCommit; head: boolean; last: boolean }) {
  const t = useT();
  const locale = useLocale();
  const unpushed = commit.pushed === false;
  return <li className="relative flex items-start gap-2.5 rounded-lg px-1.5 py-1">
    {last ? null : <span aria-hidden className="bg-default absolute top-5 -bottom-1.5 left-[0.9rem] w-0.5 rounded-full" />}
    <span aria-hidden className={`relative mt-1 size-3.5 shrink-0 rounded-full border-2 ${unpushed ? 'border-warning bg-warning/20' : 'border-muted bg-background'}`} />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm" title={commit.subject}>{commit.subject}</p>
      <p className="text-muted flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        <span className="text-accent font-mono" title={commit.sha}>{commit.sha.slice(0, 7)}</span>
        <span className="truncate" title={new Date(commit.authoredAt * 1000).toLocaleString(locale)}>{commit.authorName} · {relativeTime(commit.authoredAt, locale)}</span>
        {unpushed ? <Chip size="sm" variant="soft" color="warning">{t('git.unpushed')}</Chip> : null}
        {head ? <Chip size="sm" variant="soft">HEAD</Chip> : null}
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
    if (commits.loading) return <Spinner size="sm" />;
    if (commits.error) return <SectionError error={commits.error} />;
    return <p className="text-muted text-xs">{t('git.noCommits')}</p>;
  }
  const nextCount = Math.min(GIT_LOG_PAGE_SIZE, commits.hasMore ? GIT_LOG_PAGE_SIZE : commits.items.length - shown);
  return <div>
    <ol aria-label={t('git.commitHistory')}>
      {visible.map((commit, index) => <CommitRow key={commit.sha} commit={commit} head={index === 0} last={index === visible.length - 1} />)}
    </ol>
    {commits.error ? <SectionError error={commits.error} /> : null}
    {canShowMore || shown > 1 ? <div className="flex items-center gap-1 pt-1">
      {canShowMore ? <Button size="sm" variant="ghost" className="text-accent h-7 px-2 text-xs" isPending={commits.loading} onPress={() => void more()}>
        {({ isPending }) => <>{isPending ? <Spinner size="sm" /> : <RiArrowDownSLine className="size-4" />}{t('git.showEarlierCommits', { count: nextCount })}</>}
      </Button> : null}
      {shown > 1 ? <Button size="sm" variant="ghost" className="text-muted h-7 px-2 text-xs" onPress={() => setShown(1)}>
        <RiArrowUpSLine className="size-4" />{t('git.collapse')}
      </Button> : null}
    </div> : null}
  </div>;
}

function PullRequestCard({ pr }: { pr: GitPullRequest }) {
  const t = useT();
  const url = externalHttpUrl(pr.url);
  const state = pr.draft ? t('git.draft') : pr.state === 'merged' ? t('git.prStateMerged') : pr.state === 'closed' ? t('git.prStateClosed') : t('git.prStateOpen');
  const iconColor = pr.state === 'merged' ? 'text-accent' : pr.state === 'closed' ? 'text-danger' : 'text-success';
  const merge = pr.mergeable === 'mergeable' ? <Chip size="sm" variant="soft" color="success">{t('git.mergeable')}</Chip>
    : pr.mergeable === 'unknown' ? <Chip size="sm" variant="soft">{t('git.mergeStateUnknown')}</Chip>
    : <Chip size="sm" variant="soft" color="danger">{t('git.unmergeable', { detail: prMergeStateKeys[pr.mergeState] ? ` · ${t(prMergeStateKeys[pr.mergeState])}` : '' })}</Chip>;
  const checks = [
    t('git.checksPassing', { count: pr.checks.passing }),
    pr.checks.failing ? t('git.checksFailing', { count: pr.checks.failing }) : '',
    pr.checks.pending ? t('git.checksPending', { count: pr.checks.pending }) : '',
  ].filter(Boolean).join(' · ');
  return <Link href={url || undefined} target="_blank" rel="noopener noreferrer" isDisabled={!url}
    aria-label={t('git.openPrInBrowser', { number: pr.number, title: pr.title })}
    className="bg-surface-secondary hover:border-accent/50 block w-full space-y-1.5 rounded-xl border border-transparent p-3 text-foreground no-underline transition-colors">
    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
      <RiGitPullRequestLine className={`size-4 shrink-0 ${iconColor}`} />
      <span className="shrink-0 font-mono">#{pr.number}</span>
      <span className="min-w-0 flex-1 truncate">{pr.title}</span>
      {url ? <span className="text-muted flex shrink-0 items-center gap-1 text-xs font-normal"><RiExternalLinkLine className="size-3.5" />{t('git.openInBrowser')}</span> : null}
    </span>
    <span className="text-muted block truncate font-mono text-xs">{pr.headRef} → {pr.baseRef}</span>
    <span className="flex flex-wrap gap-1.5">
      <Chip size="sm" variant="soft" color="accent">{state}</Chip>
      {merge}
      <Chip size="sm" variant="soft" color={pr.checks.failing ? 'danger' : pr.checks.pending ? 'warning' : 'success'}>{checks}</Chip>
      <Chip size="sm" variant="soft">{t('git.reviewsSummary', { approved: pr.reviews.approved, changes: pr.reviews.changesRequested, comments: pr.reviews.commented })}</Chip>
    </span>
  </Link>;
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
    return <div className="text-muted flex flex-col items-center gap-2 px-6 py-12 text-center text-sm">
      <RiFolderAddLine className="size-8" />
      <p className="text-foreground font-semibold">{t('git.notRepoTitle')}</p>
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
        : prSnapshot ? <p className="text-muted text-xs">{prSnapshot.branch ? t('git.noPrOnBranch', { branch: prSnapshot.branch }) : t('git.noPrDetached')}</p>
        : <Spinner size="sm" />}
    </Section>
    <Section icon={<RiGitBranchLine className="size-3.5" />} title={t('git.sectionBranches')}
      action={<JumpButton label={t('git.jumpBranchActions')} onPress={() => onJump('branches')} />}>
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="font-mono text-sm font-semibold">{status.branch || t('git.noCommitDetached')}</span>
        {status.worktreeKind ? <Chip size="sm" variant="soft" color={status.worktreeKind === 'linked' ? 'accent' : 'default'}>
          {status.worktreeKind === 'linked' ? t('git.linkedWorktree') : t('git.mainWorktree')}
        </Chip> : null}
        {snapshot ? <span className="text-muted text-xs">{t('git.branchCounts', { local: localBranches, remote: remoteBranches, worktrees: worktrees.length })}</span> : null}
      </p>
      {overview.workspace.error ? <SectionError error={overview.workspace.error} />
        : !snapshot ? <Spinner size="sm" />
        : worktrees.length > 1 ? <ul className="space-y-0.5">
          {worktrees.map(tree => <li key={tree.path} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${tree.current ? 'bg-accent/10' : ''}`}>
            <RiStackLine className="text-muted mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 truncate font-mono text-xs">{tree.branch || t('git.detachedHead')}</span>
                {tree.main ? <Chip size="sm" variant="soft">{t('git.mainWorktree')}</Chip> : null}
                {tree.current ? <Chip size="sm" variant="soft" color="accent">{t('git.currentBranch')}</Chip> : null}
                {tree.dirty ? <Chip size="sm" variant="soft" color="warning">{t('git.dirtyChanges')}</Chip> : null}
                {tree.locked ? <Chip size="sm" variant="soft"><RiLockLine className="size-3" />{t('git.locked')}</Chip> : null}
                {!tree.accessible ? <Chip size="sm" variant="soft" color="danger">{t('git.worktreeInaccessible')}</Chip> : null}
              </div>
              <p className="text-muted truncate font-mono text-xs" title={tree.path}>{tree.path}</p>
            </div>
          </li>)}
        </ul> : null}
    </Section>
  </div>;
}

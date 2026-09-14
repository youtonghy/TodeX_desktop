import { t, type MessageKey } from '../i18n';

export type GitAgentActionId =
  | 'init'
  | 'commit'
  | 'commit-and-push'
  | 'push'
  | 'list-branches'
  | 'create-branch'
  | 'switch-branch'
  | 'list-worktrees'
  | 'create-worktree'
  | 'switch-worktree'
  | 'manage-worktrees'
  | 'handoff'
  | 'create-pr'
  | 'view-pr'
  | 'explain-pr'
  | 'fix-pr-comments'
  | 'fix-pr-checks'
  | 'resolve-pr-conflicts'
  | 'fix-pr-all'
  | 'merge-pr'
  | 'enable-pr-auto-merge'
  | 'disable-pr-auto-merge'
  | 'manage-pr'
  | 'draft-pr'
  | 'ready-pr'
  | 'close-pr'
  | 'reopen-pr';

export interface GitAgentAction {
  id: GitAgentActionId;
  mode: 'direct' | 'agent';
  title: string;
  description: string;
}

export interface GitAgentActionGroup {
  id: string;
  title: string;
  actions: readonly GitAgentAction[];
}

type GitAgentActionDef = { id: GitAgentActionId; mode: 'direct' | 'agent'; titleKey: MessageKey; descriptionKey: MessageKey };
type GitAgentActionGroupDef = { id: string; titleKey: MessageKey; actions: readonly GitAgentActionDef[] };

const actionGroupDefs: readonly GitAgentActionGroupDef[] = [
  {
    id: 'repository',
    titleKey: 'git.groupRepository',
    actions: [
      { id: 'init', mode: 'direct', titleKey: 'git.initTitle', descriptionKey: 'git.initDesc' },
      { id: 'commit', mode: 'agent', titleKey: 'git.commitTitle', descriptionKey: 'git.commitDesc' },
      { id: 'commit-and-push', mode: 'agent', titleKey: 'git.commitAndPushTitle', descriptionKey: 'git.commitAndPushDesc' },
      { id: 'push', mode: 'direct', titleKey: 'git.pushTitle', descriptionKey: 'git.pushDesc' },
    ],
  },
  {
    id: 'branches',
    titleKey: 'git.groupBranches',
    actions: [
      { id: 'list-branches', mode: 'direct', titleKey: 'git.listBranchesTitle', descriptionKey: 'git.listBranchesDesc' },
      { id: 'create-branch', mode: 'direct', titleKey: 'git.createBranchTitle', descriptionKey: 'git.createBranchDesc' },
      { id: 'switch-branch', mode: 'direct', titleKey: 'git.switchBranchTitle', descriptionKey: 'git.switchBranchDesc' },
    ],
  },
  {
    id: 'worktrees',
    titleKey: 'git.groupWorktrees',
    actions: [
      { id: 'list-worktrees', mode: 'direct', titleKey: 'git.listWorktreesTitle', descriptionKey: 'git.listWorktreesDesc' },
      { id: 'create-worktree', mode: 'direct', titleKey: 'git.createWorktreeTitle', descriptionKey: 'git.createWorktreeDesc' },
      { id: 'switch-worktree', mode: 'direct', titleKey: 'git.switchWorktreeTitle', descriptionKey: 'git.switchWorktreeDesc' },
      { id: 'manage-worktrees', mode: 'direct', titleKey: 'git.manageWorktreesTitle', descriptionKey: 'git.manageWorktreesDesc' },
    ],
  },
  {
    id: 'collaboration',
    titleKey: 'git.groupCollaboration',
    actions: [
      { id: 'handoff', mode: 'agent', titleKey: 'git.handoffTitle', descriptionKey: 'git.handoffDesc' },
    ],
  },
  {
    id: 'pull-requests', titleKey: 'git.groupPullRequests',
    actions: [
      { id: 'create-pr', mode: 'direct', titleKey: 'git.createPrTitle', descriptionKey: 'git.createPrDesc' },
      { id: 'view-pr', mode: 'direct', titleKey: 'git.viewPrTitle', descriptionKey: 'git.viewPrDesc' },
      { id: 'explain-pr', mode: 'agent', titleKey: 'git.explainPrTitle', descriptionKey: 'git.explainPrDesc' },
    ],
  },
  {
    id: 'pr-fixes', titleKey: 'git.groupPrFixes',
    actions: [
      { id: 'fix-pr-comments', mode: 'agent', titleKey: 'git.fixPrCommentsTitle', descriptionKey: 'git.fixPrCommentsDesc' },
      { id: 'fix-pr-checks', mode: 'agent', titleKey: 'git.fixPrChecksTitle', descriptionKey: 'git.fixPrChecksDesc' },
      { id: 'resolve-pr-conflicts', mode: 'agent', titleKey: 'git.resolvePrConflictsTitle', descriptionKey: 'git.resolvePrConflictsDesc' },
      { id: 'fix-pr-all', mode: 'agent', titleKey: 'git.fixPrAllTitle', descriptionKey: 'git.fixPrAllDesc' },
    ],
  },
  {
    id: 'pr-merge', titleKey: 'git.groupPrMerge',
    actions: [
      { id: 'merge-pr', mode: 'direct', titleKey: 'git.mergePrTitle', descriptionKey: 'git.mergePrDesc' },
      { id: 'enable-pr-auto-merge', mode: 'direct', titleKey: 'git.enablePrAutoMergeTitle', descriptionKey: 'git.enablePrAutoMergeDesc' },
      { id: 'disable-pr-auto-merge', mode: 'direct', titleKey: 'git.disablePrAutoMergeTitle', descriptionKey: 'git.disablePrAutoMergeDesc' },
    ],
  },
  {
    id: 'pr-management', titleKey: 'git.groupPrManagement',
    actions: [
      { id: 'manage-pr', mode: 'agent', titleKey: 'git.managePrTitle', descriptionKey: 'git.managePrDesc' },
      { id: 'draft-pr', mode: 'direct', titleKey: 'git.draftPrTitle', descriptionKey: 'git.draftPrDesc' },
      { id: 'ready-pr', mode: 'direct', titleKey: 'git.readyPrTitle', descriptionKey: 'git.readyPrDesc' },
      { id: 'close-pr', mode: 'direct', titleKey: 'git.closePrTitle', descriptionKey: 'git.closePrDesc' },
      { id: 'reopen-pr', mode: 'direct', titleKey: 'git.reopenPrTitle', descriptionKey: 'git.reopenPrDesc' },
    ],
  },
];

// Labels resolve lazily so the exported shape stays a plain data array while
// still following the active locale at access time.
export const gitAgentActionGroups: readonly GitAgentActionGroup[] = actionGroupDefs.map((group) => ({
  id: group.id,
  get title() { return t(group.titleKey); },
  actions: group.actions.map((action) => ({
    id: action.id,
    mode: action.mode,
    get title() { return t(action.titleKey); },
    get description() { return t(action.descriptionKey); },
  })),
}));

const actionRequestKeys: Record<GitAgentActionId, MessageKey> = {
  'view-pr': 'git.viewPrPrompt',
  'explain-pr': 'git.explainPrPrompt',
  'fix-pr-comments': 'git.fixPrCommentsPrompt',
  'fix-pr-checks': 'git.fixPrChecksPrompt',
  'resolve-pr-conflicts': 'git.resolvePrConflictsPrompt',
  'fix-pr-all': 'git.fixPrAllPrompt',
  'merge-pr': 'git.mergePrPrompt',
  'enable-pr-auto-merge': 'git.enablePrAutoMergePrompt',
  'disable-pr-auto-merge': 'git.disablePrAutoMergePrompt',
  'manage-pr': 'git.managePrPrompt',
  'draft-pr': 'git.draftPrPrompt',
  'ready-pr': 'git.readyPrPrompt',
  'close-pr': 'git.closePrPrompt',
  'reopen-pr': 'git.reopenPrPrompt',
  init: 'git.initPrompt',
  commit: 'git.commitPrompt',
  'commit-and-push': 'git.commitAndPushPrompt',
  push: 'git.pushPrompt',
  'list-branches': 'git.listBranchesPrompt',
  'create-branch': 'git.createBranchPrompt',
  'switch-branch': 'git.switchBranchPrompt',
  'list-worktrees': 'git.listWorktreesPrompt',
  'create-worktree': 'git.createWorktreePrompt',
  'switch-worktree': 'git.switchWorktreePrompt',
  'manage-worktrees': 'git.manageWorktreesPrompt',
  handoff: 'git.handoffPrompt',
  'create-pr': 'git.createPrPrompt',
};

export function buildGitAgentPrompt(
  actionId: GitAgentActionId,
  context: { workspacePath: string; workspaceName?: string },
): string {
  if (!context.workspacePath.trim()) {
    throw new Error(t('git.needWorkspacePath'));
  }
  const workspaceName = context.workspaceName?.trim();
  const scope = workspaceName ? `${t('git.promptWorkspaceName', { name: JSON.stringify(workspaceName) })}\n` : '';
  const prScope = actionId !== 'create-pr' && (actionId.endsWith('-pr') || actionId.includes('-pr-')) ? `\n\n${t('git.promptPrScope')}` : '';
  return `${scope}${t('git.promptWorkspacePath', { path: JSON.stringify(context.workspacePath) })}\n\n${t(actionRequestKeys[actionId])}${prScope}`;
}


export function buildGitFailurePrompt(
  actionId: GitAgentActionId,
  context: { workspacePath: string; workspaceName?: string },
  failure: { operation?: unknown; error: string; unknown?: boolean },
): string {
  if (!context.workspacePath.trim()) throw new Error(t('git.needWorkspacePath'));
  const title = gitAgentActionGroups.flatMap(group => group.actions).find(action => action.id === actionId)?.title || actionId;
  return [
    t('git.failureTitle', { title }),
    t('git.failurePath', { path: JSON.stringify(context.workspacePath) }),
    ...(context.workspaceName ? [t('git.failureWorkspace', { name: JSON.stringify(context.workspaceName) })] : []),
    ...(failure.operation ? [t('git.failureParams', { params: JSON.stringify(failure.operation) })] : []),
    t('git.failureError', { error: JSON.stringify(failure.error) }),
    failure.unknown ? t('git.failureUnknown') : t('git.failureCheck'),
    t('git.failureGuidance'),
  ].join('\n');
}

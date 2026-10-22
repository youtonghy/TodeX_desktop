import type { PermissionMode, ProviderDescriptor } from '@todex/protocol/v2';
import type { WorkspaceRecord } from '@todex/protocol/todex';
import type { ConversationRecord, ProviderModelPreference } from './helpers';

/** Session permission modes the client knows how to label and persist, in
 * menu order. A provider only offers the ones its `permissionConfig.modes`
 * declares. */
export const PERMISSION_MODES: readonly PermissionMode[] = ['ask', 'accept-edits', 'auto', 'full-access'];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

export function conversationPermissionCapabilities(
  conversation: ConversationRecord | null | undefined,
  providers: ProviderDescriptor[],
) {
  return providers.find((provider) => provider.id === (conversation?.provider || 'codex'))?.capabilities.permissionConfig;
}

/// `remembered` is the mode last chosen for this agent: a record without its
/// own mode (one rebuilt from a backend manifest) follows it before the
/// backend's provider default, which need not match what the user picked.
export function conversationPermissionMode(
  conversation: ConversationRecord | null | undefined,
  workspace: WorkspaceRecord | null | undefined,
  providers: ProviderDescriptor[],
  remembered?: PermissionMode,
): PermissionMode | null {
  const config = conversationPermissionCapabilities(conversation, providers);
  if (conversation?.permissionMode) return config?.modes?.includes(conversation.permissionMode) ? conversation.permissionMode : null;
  if (workspace?.permissionProfile === ':read-only' || workspace?.sandboxMode === 'read-only') return null;
  const supported = (mode: PermissionMode) => config?.modes?.includes(mode) ? mode : null;
  const profile = workspace?.permissionProfile;
  const sandbox = workspace?.sandboxMode;
  const approval = workspace?.approvalPolicy;
  const reviewer = workspace?.approvalsReviewer;
  if (profile && ![':workspace', ':danger-full-access', 'default', 'auto-review', 'full-access'].includes(profile)) return null;
  if (sandbox && !['workspace-write', 'danger-full-access'].includes(sandbox)) return null;
  if (approval && !['on-request', 'never'].includes(approval)) return null;
  if (reviewer && !['user', 'auto_review'].includes(reviewer)) return null;
  const fullProfile = profile === ':danger-full-access' || profile === 'full-access';
  if (fullProfile || sandbox === 'danger-full-access') {
    if (approval !== 'never' || reviewer === 'auto_review' || (sandbox && sandbox !== 'danger-full-access') || (profile && !fullProfile)) return null;
    return supported('full-access');
  }
  if (approval === 'never') return null;
  if (profile === 'auto-review' || reviewer === 'auto_review') return supported('auto');
  if (profile === ':workspace' || profile === 'default') return supported('ask');
  if (remembered && supported(remembered)) return remembered;
  return config?.defaultMode ? supported(config.defaultMode) : null;
}

/// Composer run modes for a new conversation: the provider's last-used values
/// win when the current capability descriptor still supports them.
export function rememberedRunModes(
  preference: ProviderModelPreference | undefined,
  config: ProviderDescriptor['capabilities']['permissionConfig'],
): { permissionMode?: PermissionMode; mode: 'plan' | 'implement' } {
  const remembered = preference?.lastPermissionMode;
  const permissionMode = remembered && config?.modes?.includes(remembered) ? remembered : config?.defaultMode;
  const mode = preference?.lastWorkMode === 'plan' && config?.supportsPlan ? 'plan' as const : 'implement' as const;
  return { permissionMode, mode };
}

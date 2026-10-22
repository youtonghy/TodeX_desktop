/** Which backend owns a workspace, conversation or command. Every backend
 * profile keeps its own connection; records carry the profile id of the
 * backend that serves them, and the None workspace (listed once per backend)
 * starts its new conversations on the backend of the None row in view. */

/** Built-in None workspace id (mirrors helpers.ts `NONE_WORKSPACE_ID`). */
const NONE_WORKSPACE_ID = 'workspace-none';

type ProfileLike = { id: string; createdAt: number };
type WorkspaceLike = { id: string; backendConnectionId?: string | null };
type ConversationLike = { workspaceId: string; backendConnectionId?: string | null; v2ConversationId?: string };
type TombstoneLike = { backendConnectionId?: string | null };

/** The backend new None-workspace conversations start on: the first of the
 * preferred ids (the open None conversation's, then the None row last picked)
 * that still exists, otherwise the first backend added. */
export function resolveNoWorkspaceBackendId(profiles: readonly ProfileLike[], ...preferredIds: Array<string | null | undefined>): string {
  const preferred = preferredIds.find((id) => id && profiles.some((profile) => profile.id === id));
  if (preferred) return preferred;
  let first: ProfileLike | undefined;
  for (const profile of profiles) {
    if (!first || profile.createdAt < first.createdAt) first = profile;
  }
  return first?.id ?? '';
}

/** Backend serving a conversation: its own tag, then its workspace's, then
 * (None workspace or nothing known) the no-workspace backend. */
export function ownerBackendId(
  conversation: ConversationLike | null | undefined,
  workspace: WorkspaceLike | null | undefined,
  noWorkspaceBackendId: string,
): string {
  return conversation?.backendConnectionId || workspace?.backendConnectionId || noWorkspaceBackendId;
}

/** Records saved before every backend stayed connected may lack a backend
 * tag: they belonged to whichever backend was active, so they are tagged
 * with it once. None-workspace drafts that never reached a backend stay
 * untagged and follow the no-workspace backend. Returns the inputs when
 * nothing needed a tag. */
export function tagLegacyBackendRecords<W extends WorkspaceLike, C extends ConversationLike, T extends TombstoneLike>(
  records: { workspaces: W[]; conversations: C[]; tombstones: T[] },
  backendId: string,
): { workspaces: W[]; conversations: C[]; tombstones: T[] } {
  if (!backendId) return records;
  const workspaces = records.workspaces.map((workspace) => (
    workspace.id === NONE_WORKSPACE_ID || workspace.backendConnectionId ? workspace : { ...workspace, backendConnectionId: backendId }
  ));
  const conversations = records.conversations.map((conversation) => (
    conversation.backendConnectionId || conversation.workspaceId !== NONE_WORKSPACE_ID || !conversation.v2ConversationId
      ? conversation
      : { ...conversation, backendConnectionId: backendId }
  ));
  const tombstones = records.tombstones.map((tombstone) => (
    tombstone.backendConnectionId ? tombstone : { ...tombstone, backendConnectionId: backendId }
  ));
  const same = <R,>(left: R[], right: R[]) => left.every((item, index) => item === right[index]);
  return {
    workspaces: same(workspaces, records.workspaces) ? records.workspaces : workspaces,
    conversations: same(conversations, records.conversations) ? records.conversations : conversations,
    tombstones: same(tombstones, records.tombstones) ? records.tombstones : tombstones,
  };
}


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


type DaemonProfileLike = ProfileLike & {
  serverUrl: string;
  encryptionPublicKey: string;
  transportVerified: boolean;
  disabled?: boolean;
};

/**
 * Profiles that reach a backend another profile already serves over IPC.
 * Two profiles name the same daemon when both pinned the same transport key,
 * or when `reachesSameDaemon` says the TCP address is the IPC daemon's
 * listener. Each enabled TCP profile that does is paired with the IPC
 * profile that takes over: one daemon, one enabled profile, so its records
 * (whose ids the daemon issues) are listed once.
 */
export function ipcDaemonConflicts<P extends DaemonProfileLike>(
  profiles: readonly P[],
  isIpc: (serverUrl: string) => boolean,
  reachesSameDaemon: (ipcUrl: string, serverUrl: string) => boolean = () => false,
): Array<{ loserId: string; winnerId: string }> {
  const enabled = profiles.filter((profile) => !profile.disabled);
  const conflicts: Array<{ loserId: string; winnerId: string }> = [];
  for (const winner of enabled) {
    if (!isIpc(winner.serverUrl)) continue;
    const pinned = winner.transportVerified && winner.encryptionPublicKey;
    for (const loser of enabled) {
      if (loser === winner || isIpc(loser.serverUrl) || conflicts.some((item) => item.loserId === loser.id)) continue;
      const sameKey = Boolean(pinned) && loser.transportVerified && loser.encryptionPublicKey === winner.encryptionPublicKey;
      if (sameKey || reachesSameDaemon(winner.serverUrl, loser.serverUrl)) conflicts.push({ loserId: loser.id, winnerId: winner.id });
    }
  }
  return conflicts;
}

/**
 * Files the records of backend `fromId` under `toId`, a profile of the same
 * daemon. A workspace or conversation `toId` already lists (the daemon gave
 * both profiles the same ids) keeps the `toId` record; `conversationIds`
 * maps each dropped conversation id to the one kept in its place.
 */
export function moveBackendRecords<
  W extends WorkspaceLike,
  C extends ConversationLike & { id: string },
  T extends TombstoneLike,
>(
  records: { workspaces: W[]; conversations: C[]; tombstones: T[] },
  fromId: string,
  toId: string,
): { workspaces: W[]; conversations: C[]; tombstones: T[]; conversationIds: Map<string, string> } {
  const targetWorkspaceIds = new Set(records.workspaces.filter((item) => item.backendConnectionId === toId).map((item) => item.id));
  const workspaces = records.workspaces.flatMap((workspace) => {
    if (workspace.backendConnectionId !== fromId) return [workspace];
    return targetWorkspaceIds.has(workspace.id) ? [] : [{ ...workspace, backendConnectionId: toId }];
  });
  const targetConversations = new Map<string, string>();
  for (const conversation of records.conversations) {
    if (conversation.backendConnectionId === toId && conversation.v2ConversationId) targetConversations.set(conversation.v2ConversationId, conversation.id);
  }
  const conversationIds = new Map<string, string>();
  const conversations = records.conversations.flatMap((conversation) => {
    if (conversation.backendConnectionId !== fromId) return [conversation];
    const kept = conversation.v2ConversationId ? targetConversations.get(conversation.v2ConversationId) : undefined;
    if (kept) {
      conversationIds.set(conversation.id, kept);
      return [];
    }
    return [{ ...conversation, backendConnectionId: toId }];
  });
  const tombstones = records.tombstones.map((tombstone) => (
    tombstone.backendConnectionId === fromId ? { ...tombstone, backendConnectionId: toId } : tombstone
  ));
  return { workspaces, conversations, tombstones, conversationIds };
}

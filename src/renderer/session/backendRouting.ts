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

/** What deleting workspace `workspaceId` of backend `backendId` removes
 * locally. Backends name a workspace after its canonical path, so two
 * backends' workspaces at the same path share an id: the backend tells them
 * apart. Untagged records follow `fallbackBackendId` (the active backend);
 * an untagged conversation follows the first workspace with its id, as
 * everywhere else. Terminals go with their workspace or a removed
 * conversation. */
export function workspaceRemovalScope<W extends WorkspaceLike, C extends ConversationLike & { id: string }>(
  workspaces: readonly W[],
  conversations: readonly C[],
  workspaceId: string,
  backendId: string,
  fallbackBackendId: string,
): {
  workspace: (workspace: W) => boolean;
  conversation: (conversation: C) => boolean;
  terminal: (terminal: { workspaceId: string; conversationId: string; backendConnectionId?: string | null }) => boolean;
  conversationIds: string[];
} {
  const backendOf = (record: { backendConnectionId?: string | null }) => record.backendConnectionId || fallbackBackendId;
  const firstWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const conversation = (item: C) => item.workspaceId === workspaceId
    && ownerBackendId(item, firstWorkspace, fallbackBackendId) === backendId;
  const conversationIds = conversations.filter(conversation).map((item) => item.id);
  const removed = new Set(conversationIds);
  return {
    workspace: (workspace) => workspace.id === workspaceId && backendOf(workspace) === backendId,
    conversation,
    terminal: (terminal) => removed.has(terminal.conversationId)
      || (terminal.workspaceId === workspaceId && backendOf(terminal) === backendId),
    conversationIds,
  };
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
  mesh?: { nodeId: string };
};

/** The group node id of the daemon an IPC profile serves, once known. */
export type IpcNodeOf = (ipcProfileId: string) => string | undefined;

/**
 * A device-group node profile whose daemon an IPC profile serves: it stays
 * connected so this device is present in the group and its roster, joins
 * and presence keep flowing, but carries no data (the IPC profile does).
 */
export function isStandbyProfile(profile: { disabled?: boolean; mesh?: unknown } | null | undefined): boolean {
  return Boolean(profile?.disabled && profile.mesh);
}

function sameDaemonKey(ipc: DaemonProfileLike, other: DaemonProfileLike): boolean {
  return Boolean(ipc.transportVerified && ipc.encryptionPublicKey)
    && other.transportVerified && other.encryptionPublicKey === ipc.encryptionPublicKey;
}

/** Whether what is known of `other` says it is not `ipc`'s daemon: both
 * pinned a transport key and the keys differ, or it is a group node other
 * than the one the IPC daemon reported being. */
function anotherDaemon(ipc: DaemonProfileLike, other: DaemonProfileLike, ipcNode: string | undefined): boolean {
  const keysDiffer = Boolean(ipc.transportVerified && ipc.encryptionPublicKey && other.transportVerified && other.encryptionPublicKey)
    && other.encryptionPublicKey !== ipc.encryptionPublicKey;
  return keysDiffer || Boolean(ipcNode && other.mesh && other.mesh.nodeId !== ipcNode);
}

/**
 * The other profiles of `profileId`'s daemon: both pinned the same transport
 * key (an IPC profile and the loopback or group node profile it took over,
 * say). Each holds its own device key and history key for that one backend,
 * so history readable by one can be granted to the others without asking.
 */
export function sameDaemonProfiles<P extends DaemonProfileLike>(profiles: readonly P[], profileId: string): P[] {
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile?.transportVerified || !profile.encryptionPublicKey) return [];
  return profiles.filter((other) => other.id !== profileId && sameDaemonKey(profile, other));
}

/**
 * The disabled profiles of `profileId`'s daemon whose saved SSH passwords an
 * enabled `profileId` takes over, newest first (the first holding a host's
 * password wins). They were swapped out for `profileId`, possibly by builds
 * that left the passwords behind; an enabled sibling keeps its own.
 */
export function sshPasswordDonors<P extends DaemonProfileLike>(profiles: readonly P[], profileId: string): P[] {
  if (profiles.find((item) => item.id === profileId)?.disabled) return [];
  return sameDaemonProfiles(profiles, profileId)
    .filter((other) => other.disabled)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Entries of a record keyed `<profileId>::<rest>` (provider model
 * preferences) re-filed from `fromId` to `toId`; an entry `toId` already has
 * wins. Returns the input when nothing moved.
 */
export function moveProfileKeyedEntries<V>(entries: Readonly<Record<string, V>>, fromId: string, toId: string): Record<string, V> {
  const prefix = `${fromId}::`;
  let moved: Record<string, V> | null = null;
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(prefix)) continue;
    moved ??= { ...entries };
    delete moved[key];
    const target = `${toId}::${key.slice(prefix.length)}`;
    if (!(target in entries)) moved[target] = value;
  }
  return moved ?? (entries as Record<string, V>);
}

/**
 * Profiles that reach a backend another profile already serves over IPC.
 * Two profiles name the same daemon when both pinned the same transport key,
 * when `reachesSameDaemon` says the TCP address is the IPC daemon's
 * listener, or when a group node profile names the node `nodeOf` learned
 * over IPC. The address is only a guess: a loopback address on the daemon's
 * port can be an SSH tunnel to another backend, so it does not count against
 * a pinned key or node id that says otherwise (`anotherDaemon`); such a
 * profile would be resumed as an orphaned standby at once, and disabled
 * again, without end. Each enabled TCP profile that does is paired with the IPC
 * profile that takes over: one daemon, one enabled profile, so its records
 * (whose ids the daemon issues) are listed once. A group node profile that
 * loses stays connected as a standby (`isStandbyProfile`).
 */
export function ipcDaemonConflicts<P extends DaemonProfileLike>(
  profiles: readonly P[],
  isIpc: (serverUrl: string) => boolean,
  reachesSameDaemon: (ipcUrl: string, serverUrl: string) => boolean = () => false,
  nodeOf: IpcNodeOf = () => undefined,
): Array<{ loserId: string; winnerId: string }> {
  const enabled = profiles.filter((profile) => !profile.disabled);
  const conflicts: Array<{ loserId: string; winnerId: string }> = [];
  for (const winner of enabled) {
    if (!isIpc(winner.serverUrl)) continue;
    const node = nodeOf(winner.id);
    for (const loser of enabled) {
      if (loser === winner || isIpc(loser.serverUrl) || conflicts.some((item) => item.loserId === loser.id)) continue;
      const sameNode = Boolean(node) && loser.mesh?.nodeId === node;
      const sameAddress = !anotherDaemon(winner, loser, node) && reachesSameDaemon(winner.serverUrl, loser.serverUrl);
      if (sameDaemonKey(winner, loser) || sameNode || sameAddress) {
        conflicts.push({ loserId: loser.id, winnerId: winner.id });
      }
    }
  }
  return conflicts;
}

/**
 * Standby group node profiles no enabled IPC profile serves any more (it
 * was removed or swapped out): they carry their daemon's data again. An IPC
 * profile whose node is not known yet (not connected so far) still counts,
 * so a standby does not flip back and forth while the IPC link starts.
 */
export function orphanedStandbyProfiles<P extends DaemonProfileLike>(
  profiles: readonly P[],
  isIpc: (serverUrl: string) => boolean,
  nodeOf: IpcNodeOf = () => undefined,
): P[] {
  const ipcProfiles = profiles.filter((profile) => !profile.disabled && isIpc(profile.serverUrl));
  return profiles.filter((standby) => isStandbyProfile(standby) && !ipcProfiles.some((ipc) => {
    const node = nodeOf(ipc.id);
    return sameDaemonKey(ipc, standby) || node === undefined || node === standby.mesh!.nodeId;
  }));
}

/**
 * The paired TCP profile of the native daemon to re-point at its IPC socket
 * instead of pairing a new device: connecting it keeps the device key, and
 * with it the history access and the records filed under the profile.
 * Enabled profiles come first, then the most recently updated.
 */
export function reusableNativeProfile<P extends DaemonProfileLike & { updatedAt: number }>(
  profiles: readonly P[],
  isIpc: (serverUrl: string) => boolean,
  reachesNativeDaemon: (serverUrl: string) => boolean,
  isPaired: (profile: P) => boolean,
): P | undefined {
  return profiles
    .filter((profile) => !isIpc(profile.serverUrl) && reachesNativeDaemon(profile.serverUrl) && isPaired(profile))
    .sort((a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled)) || b.updatedAt - a.updatedAt)[0];
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

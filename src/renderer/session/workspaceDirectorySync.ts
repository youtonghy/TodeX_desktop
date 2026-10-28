// Workspace directory sync with a backend: what a `GET /v2/workspaces`
// answer does to the local records (merge, deleted workspaces, missing
// paths), and the epochs that keep stale conversation lists from undoing a
// create, fork or delete. Pure, so the decisions are testable apart from
// the session hook, which applies them.
import {
  mergeWorkspaceRecords,
  normalizeWorkspacePath,
  workspaceMatchesTombstone,
  type WorkspaceRecord,
  type WorkspaceSyncRejection,
  type WorkspaceTombstone,
} from '@todex/protocol/todex';
import { isNoneWorkspaceId } from './helpers';

export type WorkspaceDirectoryMerge = {
  /** This backend's workspaces before and after the merge (for remapping
   * records that point at a workspace whose id the backend assigned). */
  localScoped: WorkspaceRecord[];
  nextScoped: WorkspaceRecord[];
  /** Every workspace after the merge: other backends' unchanged, None last. */
  nextWorkspaces: WorkspaceRecord[];
  /** The remote records kept (not deleted here); what the backend should hold. */
  keptRemote: WorkspaceRecord[];
  /** Remote ids deleted on this device whose DELETE must be sent again. */
  staleRemoteIds: string[];
  /** The deleted-workspace records still needed (the backend still lists a
   * match), or null when none can be dropped. */
  survivingTombstones: WorkspaceTombstone[] | null;
};

/** Marks a workspace whose path the backend reported missing (or clears it). */
export function flagWorkspaceMissing(workspace: WorkspaceRecord, missingKeys: ReadonlySet<string>, backendId: string): WorkspaceRecord {
  if (workspace.backendConnectionId !== backendId) return workspace;
  const pathMissing = missingKeys.has(normalizeWorkspacePath(workspace.path)) || undefined;
  return workspace.pathMissing === pathMissing ? workspace : { ...workspace, pathMissing };
}

/** Merges backend `backendId`'s directory answer into `workspaces`. The
 * None workspace is local-only and stays out of the merge; workspaces
 * deleted here (`tombstones`) are not merged back. */
export function mergeWorkspaceDirectory(options: {
  backendId: string;
  remote: WorkspaceRecord[];
  rejections: WorkspaceSyncRejection[];
  workspaces: WorkspaceRecord[];
  tombstones: WorkspaceTombstone[];
}): WorkspaceDirectoryMerge {
  const { backendId, remote, rejections, workspaces, tombstones } = options;
  const missingKeys = new Set(rejections.map((item) => normalizeWorkspacePath(item.path)));
  const localScoped = workspaces.filter((workspace) => !isNoneWorkspaceId(workspace.id) && workspace.backendConnectionId === backendId);
  const scopedTombstones = tombstones.filter((item) => item.backendConnectionId === backendId);
  const tagged = remote.map((workspace) => ({ ...workspace, backendConnectionId: backendId }));
  const keptRemote = tagged.filter((workspace) => !scopedTombstones.some((item) => workspaceMatchesTombstone(workspace, item)));
  const staleRemoteIds = tagged.filter((workspace) => !keptRemote.includes(workspace)).map((workspace) => workspace.id);
  const surviving = tombstones.filter((item) => item.backendConnectionId !== backendId
    || remote.some((workspace) => workspaceMatchesTombstone(workspace, item)));
  const nextScoped = remote.length > 0
    ? mergeWorkspaceRecords(localScoped, keptRemote).map((workspace) => ({
        ...workspace,
        backendConnectionId: backendId,
        threadId: '',
        localAdapterState:
          localScoped.find((item) => item.id === workspace.id || item.path === workspace.path)?.localAdapterState
          ?? workspace.localAdapterState
          ?? 'idle',
      }))
    : localScoped;
  const nextWorkspaces = [
    ...[
      ...workspaces.filter((workspace) => !isNoneWorkspaceId(workspace.id) && workspace.backendConnectionId !== backendId),
      ...nextScoped.map((workspace) => flagWorkspaceMissing(workspace, missingKeys, backendId)),
    ].sort((left, right) => right.updatedAt - left.updatedAt),
    ...workspaces.filter((workspace) => isNoneWorkspaceId(workspace.id)),
  ];
  return {
    localScoped,
    nextScoped,
    nextWorkspaces,
    keptRemote,
    staleRemoteIds,
    survivingTombstones: surviving.length !== tombstones.length ? surviving : null,
  };
}

/** Per backend, a counter bumped by every create, fork or delete there. A
 * conversation list requested before the latest bump is stale: merging it
 * would drop the new conversation (or bring the deleted one back). */
export class ManifestEpochs {
  private epochs = new Map<string, number>();

  current(backendId: string): number {
    return this.epochs.get(backendId) ?? 0;
  }

  bump(backendId: string): void {
    this.epochs.set(backendId, this.current(backendId) + 1);
  }
}

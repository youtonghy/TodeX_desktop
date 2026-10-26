/** Idle rules of the container auto-freeze (pure; scripts/container-freeze.test.ts). */

export type ActivitySession = {
  workspaces: Array<{ id: string; backendConnectionId?: string | null }>;
  conversations: Array<{ id: string; workspaceId: string; nativeStatus?: string | null }>;
  conversationRuntimeById: Record<string, { followUps?: { items: unknown[] } } | undefined>;
  terminalById: Record<string, { backendConnectionId?: string; status: string } | undefined>;
};

/**
 * Whether anything on these profiles keeps the container busy: a running or
 * permission-waiting turn, a running terminal, or daemon-held follow-ups
 * (queued or scheduled prompts run on the daemon's own timers).
 */
export function backendActive(session: ActivitySession, profileIds: string[]): boolean {
  const workspaceIds = new Set(session.workspaces.filter((workspace) => workspace.backendConnectionId && profileIds.includes(workspace.backendConnectionId)).map((workspace) => workspace.id));
  const conversations = session.conversations.filter((conversation) => workspaceIds.has(conversation.workspaceId));
  if (conversations.some((conversation) => conversation.nativeStatus === 'running' || conversation.nativeStatus === 'waiting_permission')) return true;
  if (conversations.some((conversation) => (session.conversationRuntimeById[conversation.id]?.followUps?.items.length ?? 0) > 0)) return true;
  return Object.values(session.terminalById).some((terminal) => Boolean(terminal?.backendConnectionId && profileIds.includes(terminal.backendConnectionId)
    && (terminal.status === 'running' || terminal.status === 'starting')));
}

/** Whether a container last active at `lastActiveAt` has been idle for `minutes` (0: never freeze). */
export function idleExpired(lastActiveAt: number, now: number, minutes: number): boolean {
  return minutes > 0 && now - lastActiveAt >= minutes * 60_000;
}


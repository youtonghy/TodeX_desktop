import type { BackendConnectionProfile } from '../../session/backendColors';
import type { ConfigSyncPreset } from '../../session/useConfigSync';
import type { BackendLinkStatus, TodeXSession } from '../../session/useTodeXSession';

/** `page` value of the config sync page (backend ids never take this form). */
export const CONFIG_SYNC_PAGE = '__config-sync__';

/** What "sync agent config to a new backend" preselects; SSH hosts are
 * left out because the target rarely holds the matching private keys. */
export const AGENT_CONFIG_CATEGORIES: ConfigSyncPreset['categories'] = ['accounts', 'settings', 'mcp', 'skills'];

export function linkOf(session: TodeXSession, backendId: string): BackendLinkStatus | undefined {
  return session.backendLinkStatus[backendId];
}

/** The backend to copy agent config from: the paired backend other than
 * `targetId` that connected most recently, else the first paired one. */
export function agentConfigSource(session: TodeXSession, targetId: string): BackendConnectionProfile | undefined {
  const candidates = session.backendConnections.filter(item => item.id !== targetId && item.deviceSecret);
  const openedAt = (item: BackendConnectionProfile) => linkOf(session, item.id)?.openedAt ?? 0;
  return candidates.reduce<BackendConnectionProfile | undefined>(
    (best, item) => (!best || openedAt(item) > openedAt(best) ? item : best),
    undefined,
  );
}

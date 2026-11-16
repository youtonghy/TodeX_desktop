/** History access between this app's own profiles of one daemon (an IPC
 * profile and the loopback or group node profile it took over, say). Each
 * profile is a separate device with its own history key, so a profile
 * created later cannot read history wrapped before it registered. The keys
 * that can are on this computer already: the profile asks for a grant once,
 * and a sibling holding keys fulfils it without asking (useHistoryEncryption). */

type GrantLike = { rid: string };
type SiblingViewLike = {
  status: string;
  localRid?: string;
  accessRevoked?: boolean;
  state?: { grants: readonly GrantLike[]; myAccess?: string };
};

/** Whether this profile's device should request a history grant: its key is
 * registered, it never asked (a grant in any state counts, so a dismissed
 * one is not asked again), and a sibling with another key is ready to
 * fulfil it. */
export function needsSiblingGrant(view: SiblingViewLike | undefined, siblings: ReadonlyArray<SiblingViewLike | undefined>): boolean {
  const state = view?.state;
  if (!view || view.status !== 'ready' || !view.localRid || view.accessRevoked || !state || state.myAccess === 'revoked') return false;
  if (state.grants.some((grant) => grant.rid === view.localRid)) return false;
  return siblings.some((sibling) => sibling?.status === 'ready' && sibling.localRid && sibling.localRid !== view.localRid && !sibling.accessRevoked);
}

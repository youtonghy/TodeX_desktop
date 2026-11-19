import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeBase64Url, deviceIdentityFromSecret, generateDeviceIdentity, type DeviceIdentity } from '@todex/protocol/deviceAuth';
import { generateHistoryRecipientKeyPair } from '@todex/protocol/historyCrypto';
import { isIpcServerUrl } from '@todex/protocol/ipcServerUrl';
import {
  MESH_UPDATED_EVENT,
  appendMeshRoster,
  createMeshGenesis,
  encodeMeshInvite,
  encodeMeshInviteForQr,
  isMeshAddress,
  meshCommands,
  meshMemberForJoinRequest,
  meshNodeMember,
  meshRelayExpiry,
  meshRelayTicket,
  meshRelayUrl,
  parseMeshPresence,
  meshRecoveryKeys,
  parseMeshInvite,
  parseMeshJoinRequests,
  parseMeshNodeState,
  verifyMeshChain,
  verifyMeshNodeInfo,
  type MeshChain,
  type MeshCommandFrame,
  type MeshJoinRequest,
  type MeshMember,
  type MeshNodeInfo,
  type MeshRelayRole,
  type MeshSignedDoc,
} from '@todex/protocol/mesh';
import { platform } from '../platform';
import { recoveryWordsFromSeed } from '@todex/protocol/recoveryKey';
import { createRequestId } from '@todex/protocol/todex';
import { t } from '../i18n';
import { loadJson, loadSecret, removeSecret, saveJson, saveSecret } from '../lib/storage';
import { deleteHistorySeed, loadHistorySeed, saveHistorySeed } from '../lib/historyKeyStore';
import type { BackendConnectionProfile } from './backendColors';
import { isStandbyProfile } from './backendRouting';
import {
  DevicePairingRetryableError,
  PAIRING_POLL_INTERVAL_MS,
  beginDevicePairing,
  nextPairingPollDelayMs,
  type DevicePairingRequest,
} from './devicePairing';
import type { ConnectionState } from './helpers';
import {
  MESH_GROUPS_STORAGE_KEY,
  beaconUrls,
  candidateUrls,
  confirmLeave,
  leaveDelivered,
  mergeNodeState,
  meshDeviceSecretKey,
  meshHistoryKeyId,
  nodeInfosOf,
  normalizeStoredMeshGroups,
  rememberUrl,
  startLeave,
  storedChain,
  type MeshBeacon,
  type StoredMeshGroup,
} from './meshGroups';

/** This device's group preferences: `relay` off never relays. */
const MESH_PREFS_STORAGE_KEY = `${platform.storagePrefix}.meshPrefs.v1`;
type MeshPrefs = { relay: boolean };
/** Unreachable this long before the next address is tried. */
const ROTATE_AFTER_MS = 15_000;
/** How often a relayed node's direct addresses are checked. */
const DIRECT_PROBE_MS = 60_000;
/** Relay tickets this device issues, and when they are renewed. */
const RELAY_TICKET_MS = 24 * 60 * 60 * 1000;
const RELAY_RENEW_MS = 60 * 60 * 1000;

// Device groups on this client (TodeX_backend docs/mesh-v1.md). Every node of
// a group gets a backend profile (`profile.mesh`) signed with the group's
// member key and decrypting with the group's history key, so the rest of the
// session treats it like any paired backend. On each connect the node's
// group state is read and merged (the roster chain under the fork rule, node
// infos), and pushed back when the node is behind; `mesh.updated` re-reads.
// Join requests of every connected node are listed for approval here; an
// approval appends the new device to the roster, so the node lets it in.
//
// A node this client also reaches over IPC (the desktop's own backend) keeps
// its group profile as a standby (`isStandbyProfile`): connected, so this
// device is present in the group and its roster and joins flow, while the
// IPC profile carries the data. Group addresses are always network ones.

export type MeshPairingCredentials = Pick<BackendConnectionProfile, 'deviceSecret' | 'encryptionProtocol' | 'encryptionPublicKey' | 'transportVerified'>;

export type MeshLink = { state: ConnectionState; mesh: boolean | undefined };

export type MeshMemberView = MeshMember & {
  self: boolean;
  /** Node members: the backend this client reaches over IPC; its data goes
   * there, and the group link only keeps this device present. */
  local?: boolean;
  /** Node members: their profile and its connection state. */
  profileId?: string;
  state?: ConnectionState;
  info?: MeshNodeInfo;
  /** Node members reached through another node: that node's name. */
  via?: string;
  /** Device members: connected to a node this client sees. */
  online?: boolean;
  /** Device members: when a node last saw it leave. */
  lastSeen?: number;
};

export type MeshGroupView = {
  groupId: string;
  name: string;
  version: number;
  deviceId: string;
  members: MeshMemberView[];
  /** Waiting for the first roster after joining. */
  pending: boolean;
  /** This device is leaving: the nodes that have not confirmed the final
   * roster yet. */
  leaving?: { pendingNodes: Array<{ id: string; name: string; state: ConnectionState }> };
  invite: string;
  /** The invite as a QR code carries it (`encodeMeshInviteForQr`), or null
   * when no node fits one. */
  inviteQr: { text: string; trimmed: boolean } | null;
};

export type MeshJoinView = MeshJoinRequest & { profileId: string; groupName: string };

export type MeshJoinProgress =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'waiting'; verificationCode: string; nodeName: string; expiresAt: number }
  | { status: 'error'; error: string };

type HistoryGrantActions = {
  /** Re-wraps this profile's history for `deviceId`'s pending grant, if
   * any, provided the grant is for `historyKey` (its key in the roster). */
  authorizeDevice: (profileId: string, deviceId: string, historyKey: string) => Promise<void>;
};

export function useMeshGroups({
  hydrated,
  profiles,
  links,
  send,
  addProfile,
  updateProfile,
  removeProfile,
  approveCredentials,
  history,
  deviceName,
  onNotice,
}: {
  hydrated: boolean;
  profiles: BackendConnectionProfile[];
  links: Readonly<Record<string, MeshLink>>;
  send: (profileId: string, frame: MeshCommandFrame, timeoutMs?: number) => Promise<Record<string, unknown>>;
  addProfile: (profile: Partial<BackendConnectionProfile> & { id: string }) => void;
  updateProfile: (id: string, patch: Partial<BackendConnectionProfile>) => void;
  removeProfile: (id: string) => void;
  /** Pins the credentials and connects once the profile is committed. */
  approveCredentials: (id: string, credentials: MeshPairingCredentials) => void;
  history: HistoryGrantActions;
  deviceName: string;
  /** A device asked to join, or this device was removed from a group. */
  onNotice: (notice: { kind: 'joinRequested'; request: MeshJoinView } | { kind: 'removed'; groupName: string }) => void;
}) {
  const [groups, setGroupsState] = useState<StoredMeshGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [joinRequests, setJoinRequests] = useState<Record<string, MeshJoinRequest[]>>({});
  const [joinProgress, setJoinProgress] = useState<MeshJoinProgress>({ status: 'idle' });
  const [prefs, setPrefsState] = useState<MeshPrefs>({ relay: true });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Per node profile: the group's presence as that node reported it. */
  const [presence, setPresence] = useState<Record<string, ReturnType<typeof parseMeshPresence>>>({});
  /** Per IPC profile: the group node id of the daemon it serves. */
  const [ipcNodeIds, setIpcNodeIds] = useState<Record<string, string>>({});
  const ipcNodeIdsRef = useRef(ipcNodeIds);
  ipcNodeIdsRef.current = ipcNodeIds;
  const beacons = useRef<MeshBeacon[]>([]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const live = useRef({ profiles, links, send, addProfile, updateProfile, removeProfile, approveCredentials, history, deviceName, onNotice });
  live.current = { profiles, links, send, addProfile, updateProfile, removeProfile, approveCredentials, history, deviceName, onNotice };
  const joinAbort = useRef<AbortController | null>(null);

  const setGroups = useCallback((next: StoredMeshGroup[]) => {
    groupsRef.current = next;
    setGroupsState(next);
    void saveJson(MESH_GROUPS_STORAGE_KEY, next);
  }, []);
  const replaceGroup = useCallback((group: StoredMeshGroup) => {
    setGroups(groupsRef.current.some((item) => item.groupId === group.groupId)
      ? groupsRef.current.map((item) => (item.groupId === group.groupId ? group : item))
      : [...groupsRef.current, group]);
  }, [setGroups]);

  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    void loadJson<Partial<MeshPrefs> | null>(MESH_PREFS_STORAGE_KEY, null).then((value) => {
      if (alive && value) setPrefsState({ relay: value.relay !== false });
    });
    void loadJson<unknown>(MESH_GROUPS_STORAGE_KEY, []).then((value) => {
      if (!alive) return;
      const stored = normalizeStoredMeshGroups(value);
      groupsRef.current = stored;
      setGroupsState(stored);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [hydrated]);

  const identityOf = useCallback(async (groupId: string): Promise<DeviceIdentity> => {
    const identity = deviceIdentityFromSecret(await loadSecret(meshDeviceSecretKey(groupId)));
    if (!identity) throw new Error(t('mesh.keyMissing'));
    return identity;
  }, []);

  const profileOf = (groupId: string, nodeId: string) => live.current.profiles.find((profile) => profile.mesh?.groupId === groupId && profile.mesh.nodeId === nodeId);
  const connectedProfiles = (groupId: string) => live.current.profiles.filter((profile) => profile.mesh?.groupId === groupId
    && live.current.links[profile.id]?.state === 'open' && live.current.links[profile.id]?.mesh);
  /** The enabled IPC profile serving node `nodeId` (the transport key its
   * info announces, or the node id the IPC daemon reported). */
  const ipcProfileOf = (nodeId: string, info: MeshNodeInfo | undefined) => live.current.profiles.find((profile) => (
    !profile.disabled && !profile.mesh && isIpcServerUrl(profile.serverUrl) && (
      ipcNodeIdsRef.current[profile.id] === nodeId
      || Boolean(info?.transportPublicKey && profile.transportVerified && profile.encryptionPublicKey === info.transportPublicKey)
    )
  ));

  /** Sends the group's chain and node infos to every connected node of it.
   * Returns the nodes that accepted it; a node that did not catches up from
   * a device later (or, while this device leaves, from the next push). */
  const pushToAll = useCallback(async (group: StoredMeshGroup, extraProfileIds: string[] = []): Promise<Set<string>> => {
    const ids = new Set([...connectedProfiles(group.groupId).map((profile) => profile.id), ...extraProfileIds]);
    const infos = Object.values(group.nodeInfos);
    const confirmed = new Set<string>();
    await Promise.all([...ids].map(async (profileId) => {
      try {
        await live.current.send(profileId, meshCommands.statePush(group.chain, infos));
        const nodeId = live.current.profiles.find((profile) => profile.id === profileId)?.mesh?.nodeId;
        if (nodeId) confirmed.add(nodeId);
      } catch {
        // Not delivered: see above.
      }
    }));
    return confirmed;
  }, []);

  /** Forgets a group this device left or was removed from: its profiles,
   * keys and record. */
  const forgetGroup = useCallback(async (groupId: string) => {
    const groupSecret = await loadSecret(meshDeviceSecretKey(groupId)).catch(() => null);
    for (const profile of live.current.profiles) {
      if (profile.mesh?.groupId === groupId) live.current.removeProfile(profile.id);
      // An IPC profile an older client switched to the group key loses its
      // access with the group: it pairs again with a key of its own.
      else if (groupSecret && profile.deviceSecret === groupSecret) live.current.updateProfile(profile.id, { deviceSecret: '', transportVerified: false });
    }
    setGroups(groupsRef.current.filter((item) => item.groupId !== groupId));
    setJoinRequests((current) => Object.fromEntries(Object.entries(current).filter(([profileId]) => live.current.profiles.find((profile) => profile.id === profileId)?.mesh?.groupId !== groupId)));
    await removeSecret(meshDeviceSecretKey(groupId)).catch(() => undefined);
    await deleteHistorySeed(meshHistoryKeyId(groupId)).catch(() => undefined);
  }, [setGroups]);

  /** Records that node `nodeId` confirmed this device's final roster, and
   * forgets the group once the leave is delivered. */
  const settleLeave = useCallback(async (groupId: string, nodeId: string | null) => {
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    if (!group?.leaving) return;
    const leaving = nodeId ? confirmLeave(group.leaving, nodeId) : group.leaving;
    if (leaveDelivered(leaving)) {
      await forgetGroup(groupId);
      return;
    }
    if (leaving !== group.leaving) replaceGroup({ ...group, leaving });
  }, [forgetGroup, replaceGroup]);

  /** Which group devices `profileId`'s node has connected. */
  const refreshPresence = useCallback(async (profileId: string, groupId: string) => {
    try {
      const reported = parseMeshPresence(await live.current.send(profileId, meshCommands.presenceGet(groupId)));
      setPresence((current) => ({ ...current, [profileId]: reported }));
    } catch {
      // Older nodes do not report presence.
    }
  }, []);

  /** Reads one node's group state and join requests and merges them. */
  const syncing = useRef(new Map<string, Promise<void>>());
  const notified = useRef(new Set<string>());
  const syncProfile = useCallback((profileId: string): Promise<void> => {
    const running = syncing.current.get(profileId);
    if (running) return running;
    const run = (async () => {
      const profile = live.current.profiles.find((item) => item.id === profileId);
      const groupId = profile?.mesh?.groupId;
      const stored = groupsRef.current.find((item) => item.groupId === groupId);
      if (!profile?.mesh || !stored) return;
      if (stored.leaving) {
        // This device is leaving: the node only needs the final roster.
        if (!stored.leaving.pendingNodes.includes(profile.mesh.nodeId)) return;
        await live.current.send(profileId, meshCommands.statePush(stored.chain, Object.values(stored.nodeInfos)));
        await settleLeave(stored.groupId, profile.mesh.nodeId);
        return;
      }
      const state = parseMeshNodeState(await live.current.send(profileId, meshCommands.stateGet()));
      if (state.nodeId !== profile.mesh.nodeId) {
        // The invite named the node; the node's own answer wins.
        live.current.updateProfile(profileId, { mesh: { groupId: stored.groupId, nodeId: state.nodeId } });
      }
      const remote = state.groups.find((item) => item.groupId === stored.groupId);
      const outcome = mergeNodeState(stored, { nodeId: state.nodeId, nodeInfo: state.nodeInfo, chain: remote?.chain, nodeInfos: remote?.nodeInfos });
      let group = outcome.group;
      const remembered = profile.mesh.via || !isMeshAddress(profile.serverUrl) ? null : rememberUrl(group, state.nodeId, profile.serverUrl);
      if (remembered) group = remembered;
      if (outcome.removed) {
        live.current.onNotice({ kind: 'removed', groupName: group.name });
        await forgetGroup(group.groupId);
        return;
      }
      if (outcome.changed || remembered) replaceGroup(group);
      if (outcome.push) {
        await live.current.send(profileId, meshCommands.statePush(group.chain, Object.values(group.nodeInfos))).catch(() => undefined);
      }
      const requests = parseMeshJoinRequests(await live.current.send(profileId, meshCommands.joinList()))
        .filter((request) => request.groupId === group.groupId);
      // Each request is announced once, however many nodes list it.
      for (const request of requests) {
        if (notified.current.has(request.requestId)) continue;
        notified.current.add(request.requestId);
        live.current.onNotice({ kind: 'joinRequested', request: { ...request, profileId, groupName: group.name } });
      }
      setJoinRequests((current) => ({ ...current, [profileId]: requests }));
      await refreshPresence(profileId, group.groupId);
    })().catch(() => undefined).finally(() => { syncing.current.delete(profileId); });
    syncing.current.set(profileId, run);
    return run;
  }, [forgetGroup, replaceGroup, settleLeave]);

  // Sync on every (re)connect of a node that speaks mesh.
  const synced = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded) return;
    for (const profile of profiles) {
      const link = links[profile.id];
      const ready = Boolean(profile.mesh) && link?.state === 'open' && link.mesh === true;
      if (!ready) {
        synced.current.delete(profile.id);
        continue;
      }
      if (synced.current.has(profile.id)) continue;
      synced.current.add(profile.id);
      void syncProfile(profile.id);
    }
  }, [links, loaded, profiles, syncProfile]);

  /** `mesh.updated` from a backend. */
  const receiveEvent = useCallback((profileId: string, payload: unknown) => {
    const mesh = live.current.profiles.find((profile) => profile.id === profileId)?.mesh;
    if (!mesh) return;
    // Arrivals and departures only change who is online.
    if ((payload as { reason?: unknown } | null)?.reason === 'presence') void refreshPresence(profileId, mesh.groupId);
    else void syncProfile(profileId);
  }, [refreshPresence, syncProfile]);

  // Profiles follow the rosters: one per node of each group, pinned to the
  // transport key its signed info announces; nodes the roster dropped lose
  // theirs.
  const creating = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded) return;
    for (const group of groups) {
      const chain = storedChain(group);
      if (!chain) continue;
      const infos = nodeInfosOf(group, chain);
      const nodeIds = new Set<string>();
      for (const member of chain.head.members) {
        if (member.kind !== 'node') continue;
        nodeIds.add(member.id);
        const info = infos.get(member.id);
        const existing = profileOf(group.groupId, member.id);
        if (existing) {
          const patch: Partial<BackendConnectionProfile> = {};
          if (info && (existing.encryptionProtocol !== info.transportProtocol || existing.encryptionPublicKey !== info.transportPublicKey)) {
            patch.encryptionProtocol = info.transportProtocol;
            patch.encryptionPublicKey = info.transportPublicKey;
            patch.transportVerified = true;
          }
          if (Object.keys(patch).length) {
            live.current.updateProfile(existing.id, patch);
            live.current.approveCredentials(existing.id, {
              deviceSecret: existing.deviceSecret,
              encryptionProtocol: patch.encryptionProtocol ?? existing.encryptionProtocol,
              encryptionPublicKey: patch.encryptionPublicKey ?? existing.encryptionPublicKey,
              transportVerified: true,
            });
          }
          continue;
        }
        const url = nodeUrls(group, info, member.id, { pinned: member.addresses, beacons: beaconUrls(beacons.current, member.id) })[0];
        const key = `${group.groupId}/${member.id}`;
        if (!info || !url || creating.current.has(key)) continue;
        creating.current.add(key);
        void (async () => {
          try {
            const identity = await identityOf(group.groupId);
            const seed = await loadHistorySeed(meshHistoryKeyId(group.groupId));
            if (!seed) throw new Error(t('mesh.keyMissing'));
            const id = createRequestId('backend');
            // The history key is in place before the first connect, which
            // registers it.
            await saveHistorySeed(id, seed);
            seed.fill(0);
            // A node served over IPC starts as its standby link.
            const standby = Boolean(ipcProfileOf(member.id, info));
            live.current.addProfile({ id, name: member.name, serverUrl: url, tenantId: 'local', mesh: { groupId: group.groupId, nodeId: member.id }, ...(standby ? { disabled: true } : {}) });
            live.current.approveCredentials(id, {
              deviceSecret: identity.secretKey,
              encryptionProtocol: info.transportProtocol,
              encryptionPublicKey: info.transportPublicKey,
              transportVerified: true,
            });
          } catch {
            // Retried on the next roster or info change.
          } finally {
            creating.current.delete(key);
          }
        })();
      }
      for (const profile of profiles) {
        if (profile.mesh?.groupId === group.groupId && !nodeIds.has(profile.mesh.nodeId)) live.current.removeProfile(profile.id);
      }
    }
    // Profiles of groups this client no longer keeps.
    const known = new Set(groups.map((group) => group.groupId));
    for (const profile of profiles) {
      if (profile.mesh && !known.has(profile.mesh.groupId)) live.current.removeProfile(profile.id);
    }
  }, [groups, identityOf, ipcNodeIds, loaded, profiles]);

  // The node id behind each connected IPC profile, read once per profile.
  const askingNode = useRef(new Set<string>());
  useEffect(() => {
    for (const profile of profiles) {
      const link = links[profile.id];
      if (profile.mesh || !isIpcServerUrl(profile.serverUrl) || link?.state !== 'open' || link.mesh !== true) continue;
      if (ipcNodeIds[profile.id] || askingNode.current.has(profile.id)) continue;
      askingNode.current.add(profile.id);
      void live.current.send(profile.id, meshCommands.nodeGet()).then((response) => {
        if (typeof response.nodeId === 'string' && response.nodeId) {
          const nodeId = response.nodeId;
          setIpcNodeIds((current) => (current[profile.id] === nodeId ? current : { ...current, [profile.id]: nodeId }));
        }
      }, () => undefined).finally(() => { askingNode.current.delete(profile.id); });
    }
  }, [ipcNodeIds, links, profiles]);

  // Repairs what older clients stored: an IPC profile turned into a group
  // node profile goes back to being the IPC profile (the node gets a standby
  // of its own), and IPC addresses leave the groups' address lists.
  const repaired = useRef(false);
  useEffect(() => {
    if (!loaded || repaired.current) return;
    repaired.current = true;
    for (const profile of profiles) {
      if (profile.mesh && isIpcServerUrl(profile.serverUrl)) live.current.updateProfile(profile.id, { mesh: undefined });
    }
    const cleaned = groupsRef.current.map((group) => {
      const entries = Object.entries(group.nodeUrls);
      if (entries.every(([, urls]) => urls.every(isMeshAddress))) return group;
      return { ...group, nodeUrls: Object.fromEntries(entries.map(([nodeId, urls]) => [nodeId, urls.filter(isMeshAddress)])) };
    });
    if (cleaned.some((group, index) => group !== groupsRef.current[index])) setGroups(cleaned);
  }, [loaded, profiles, setGroups]);

  // LAN beacons (desktop): another source of node addresses.
  useEffect(() => {
    const read = platform.meshBeacons;
    if (!read) return;
    let alive = true;
    const poll = () => { void read().then((list) => { if (alive) beacons.current = list; }, () => undefined); };
    poll();
    const timer = setInterval(poll, 15_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // Getting back to a node: an unreachable node is tried at each of its
  // addresses in turn; when every one failed (and this device relays), it is
  // reached through another connected node of the group. A relayed node's
  // direct addresses are checked every minute and win as soon as one
  // answers; its ticket is renewed before it expires.
  const failing = useRef(new Map<string, { since: number; rotatedAt: number; tried: Set<string>; probedAt: number }>());
  useEffect(() => {
    const credentialsOf = (profile: BackendConnectionProfile): MeshPairingCredentials => ({
      deviceSecret: profile.deviceSecret, encryptionProtocol: profile.encryptionProtocol,
      encryptionPublicKey: profile.encryptionPublicKey, transportVerified: profile.transportVerified,
    });
    const moveTo = (profile: BackendConnectionProfile, serverUrl: string, via?: string) => {
      const credentials = credentialsOf(profile);
      const { via: _via, ...mesh } = profile.mesh!;
      live.current.updateProfile(profile.id, { serverUrl, mesh: via ? { ...mesh, via } : mesh, ...credentials });
      live.current.approveCredentials(profile.id, credentials);
    };
    const relayFor = async (profile: BackendConnectionProfile, chain: MeshChain): Promise<{ url: string; via: string } | null> => {
      const target = chain.head.members.find((member) => member.id === profile.mesh!.nodeId);
      if (!prefsRef.current.relay || !target || target.relayTarget === false) return null;
      const roleOf = (nodeId: string) => chain.head.members.find((member) => member.id === nodeId)?.relay ?? 'allowed';
      const relays = live.current.profiles
        .filter((item) => item.id !== profile.id && item.mesh?.groupId === profile.mesh!.groupId && !item.mesh.via
          && live.current.links[item.id]?.state === 'open' && /^https?:\/\//.test(item.serverUrl) && roleOf(item.mesh.nodeId) !== 'denied')
        .sort((a, b) => Number(roleOf(b.mesh!.nodeId) === 'preferred') - Number(roleOf(a.mesh!.nodeId) === 'preferred'));
      const relay = relays[0];
      if (!relay) return null;
      const identity = await identityOf(profile.mesh!.groupId);
      const ticket = meshRelayTicket({
        deviceSecretKey: decodeBase64Url(identity.secretKey), deviceId: identity.deviceId,
        relayNodeId: relay.mesh!.nodeId, targetNodeId: profile.mesh!.nodeId, expiresAt: Date.now() + RELAY_TICKET_MS,
      });
      return { url: meshRelayUrl(relay.serverUrl, profile.mesh!.nodeId, ticket), via: relay.mesh!.nodeId };
    };
    const reachable = async (url: string) => {
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3_000) });
        return response.ok;
      } catch {
        return false;
      }
    };
    let running = false;
    const check = async () => {
      const now = Date.now();
      for (const profile of live.current.profiles) {
        // Standby links (disabled group node profiles) are kept up too.
        if (!profile.mesh) continue;
        const group = groupsRef.current.find((item) => item.groupId === profile.mesh!.groupId);
        const chain = group ? storedChain(group) : null;
        if (!group || !chain) continue;
        const member = chain.head.members.find((item) => item.id === profile.mesh!.nodeId);
        const urls = nodeUrls(group, nodeInfosOf(group, chain).get(profile.mesh.nodeId), profile.mesh.nodeId, {
          pinned: member?.addresses, beacons: beaconUrls(beacons.current, profile.mesh.nodeId),
        });
        const state = live.current.links[profile.id]?.state;
        const entry = failing.current.get(profile.id) ?? { since: now, rotatedAt: 0, tried: new Set<string>(), probedAt: now };
        if (state === 'open') {
          failing.current.set(profile.id, { ...entry, since: now, tried: new Set() });
          if (!profile.mesh.via) continue;
          const expiry = meshRelayExpiry(profile.serverUrl);
          if (now - entry.probedAt >= DIRECT_PROBE_MS) {
            failing.current.set(profile.id, { ...entry, since: now, tried: new Set(), probedAt: now });
            for (const url of urls) {
              if (await reachable(url)) {
                moveTo(profile, url);
                break;
              }
            }
          } else if (expiry !== null && expiry - now < RELAY_RENEW_MS) {
            const relay = await relayFor(profile, chain);
            if (relay) moveTo(profile, relay.url, relay.via);
          }
          continue;
        }
        if (state === 'connecting' || state === undefined) continue;
        failing.current.set(profile.id, entry);
        if (now - entry.since < ROTATE_AFTER_MS || now - entry.rotatedAt < ROTATE_AFTER_MS) continue;
        entry.rotatedAt = now;
        if (!profile.mesh.via) entry.tried.add(profile.serverUrl);
        const next = urls.find((url) => !entry.tried.has(url));
        if (next) {
          moveTo(profile, next);
          continue;
        }
        // Every address failed (or the relay did): relay, else start over.
        const relay = profile.mesh.via ? null : await relayFor(profile, chain);
        entry.tried = new Set();
        if (relay) moveTo(profile, relay.url, relay.via);
        else if (urls[0] && (profile.mesh.via || urls.length > 1)) moveTo(profile, urls[0]);
      }
    };
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void check().finally(() => { running = false; });
    }, 5_000);
    return () => clearInterval(timer);
  }, [identityOf]);

  const setRelayEnabled = useCallback((relay: boolean) => {
    const next = { relay };
    setPrefsState(next);
    void saveJson(MESH_PREFS_STORAGE_KEY, next);
  }, []);

  /** Tries a node again from its best address. */
  const retryNode = useCallback((profileId: string) => {
    const profile = live.current.profiles.find((item) => item.id === profileId);
    if (!profile?.mesh) return;
    failing.current.delete(profileId);
    live.current.approveCredentials(profileId, {
      deviceSecret: profile.deviceSecret, encryptionProtocol: profile.encryptionProtocol,
      encryptionPublicKey: profile.encryptionPublicKey, transportVerified: profile.transportVerified,
    });
  }, []);

  /** A new group with this device in it; returns the recovery words. */
  const createGroup = useCallback(async (name: string): Promise<{ groupId: string; recoveryWords: string[] }> => {
    const identity = generateDeviceIdentity();
    const historyKeys = generateHistoryRecipientKeyPair();
    const recoverySeed = generateHistoryRecipientKeyPair().secretKey;
    try {
      const { recovery, signingSeed } = meshRecoveryKeys(recoverySeed);
      signingSeed.fill(0);
      const chain = createMeshGenesis({
        name: name.trim(), creatorSecretKey: decodeBase64Url(identity.secretKey), creatorName: live.current.deviceName,
        creatorHistoryKey: historyKeys.publicKey, recovery,
      });
      const groupId = verifyMeshChain(chain).groupId;
      await saveSecret(meshDeviceSecretKey(groupId), identity.secretKey);
      await saveHistorySeed(meshHistoryKeyId(groupId), historyKeys.secretKey);
      replaceGroup({ groupId, name: name.trim(), chain, nodeInfos: {}, nodeUrls: {}, deviceId: identity.deviceId, joinedAt: Date.now() });
      return { groupId, recoveryWords: recoveryWordsFromSeed(recoverySeed) };
    } finally {
      historyKeys.secretKey.fill(0);
      recoverySeed.fill(0);
    }
  }, [replaceGroup]);

  /** The chain with `edit` applied on the newest version this client can
   * see, signed by this device; stored and pushed to every connected node. */
  const editRoster = useCallback(async (
    groupId: string,
    edit: (chain: MeshChain, self: string) => { members?: MeshMember[]; name?: string },
    extraProfileIds: string[] = [],
    onPushed?: (confirmed: Set<string>) => void,
  ) => {
    for (const profile of connectedProfiles(groupId)) await syncProfile(profile.id);
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    const chain = group ? storedChain(group) : null;
    if (!group || !chain) throw new Error(t('mesh.groupMissing'));
    const identity = await identityOf(groupId);
    const docs = appendMeshRoster(chain, { signerSecretKey: decodeBase64Url(identity.secretKey), ...edit(chain, identity.deviceId) });
    const next = { ...group, chain: docs, name: edit(chain, identity.deviceId).name ?? group.name };
    onPushed?.(await pushToAll(next, extraProfileIds));
    replaceGroup(next);
    return next;
  }, [identityOf, pushToAll, replaceGroup, syncProfile]);

  /** Adds a backend this client already pairs with point to point: the
   * node joins, its history is re-wrapped for the group key, and the
   * profile switches to the group's keys in place. */
  const addPairedBackend = useCallback(async (groupId: string, profileId: string) => {
    const profile = live.current.profiles.find((item) => item.id === profileId);
    if (!profile || profile.mesh) throw new Error(t('mesh.backendUnavailable'));
    const response = await live.current.send(profileId, meshCommands.nodeGet());
    const nodeId = typeof response.nodeId === 'string' ? response.nodeId : '';
    const nodePublicKey = typeof response.nodePublicKey === 'string' ? response.nodePublicKey : '';
    const nodeInfoDoc = response.nodeInfo as MeshSignedDoc;
    const info = verifyMeshNodeInfo(nodeInfoDoc, nodePublicKey);
    if (info.nodeId !== nodeId) throw new Error(t('mesh.backendUnavailable'));
    const identity = await identityOf(groupId);
    const group = await editRoster(groupId, (chain, self) => ({
      members: [...chain.head.members.filter((member) => member.id !== nodeId),
        meshNodeMember({ publicKey: decodeBase64Url(nodePublicKey), name: profile.name || info.name, addedBy: self })],
    }), [profileId]);
    const ipc = isIpcServerUrl(profile.serverUrl);
    const withInfo = {
      ...group, nodeInfos: { ...group.nodeInfos, [nodeId]: nodeInfoDoc },
      ...(ipc ? {} : { nodeUrls: { ...group.nodeUrls, [nodeId]: [profile.serverUrl] } }),
    };
    // This profile becomes the node's group profile below: until it carries
    // `mesh`, the roster effect must not create a second one for the node.
    const reserved = `${groupId}/${nodeId}`;
    if (!ipc) creating.current.add(reserved);
    try {
      replaceGroup(withInfo);
      // The node opened a grant for the group key: this profile's own history
      // key still opens everything, so it re-wraps (before switching keys).
      const historyKey = storedChain(withInfo)?.head.members.find((member) => member.id === identity.deviceId)?.historyKey;
      if (!historyKey) throw new Error(t('mesh.groupMissing'));
      await live.current.history.authorizeDevice(profileId, identity.deviceId, historyKey);
      if (ipc) {
        // The IPC profile stays as it is and keeps the data; the node's group
        // profile is created at its network addresses as a standby.
        setIpcNodeIds((current) => ({ ...current, [profileId]: nodeId }));
        await pushToAll(withInfo);
        return;
      }
      const seed = await loadHistorySeed(meshHistoryKeyId(groupId));
      if (!seed) throw new Error(t('mesh.keyMissing'));
      await saveHistorySeed(profileId, seed);
      seed.fill(0);
      const credentials = {
        deviceSecret: identity.secretKey, encryptionProtocol: info.transportProtocol,
        encryptionPublicKey: info.transportPublicKey, transportVerified: true,
      };
      live.current.updateProfile(profileId, { ...credentials, mesh: { groupId, nodeId } });
      live.current.approveCredentials(profileId, credentials);
    } finally {
      if (!ipc) creating.current.delete(reserved);
    }
    await pushToAll(withInfo);
  }, [editRoster, identityOf, pushToAll, replaceGroup]);

  /** Adds a backend by address and its join code. */
  const addBackendWithCode = useCallback(async (groupId: string, serverUrl: string, joinCode: string, signal?: AbortSignal) => {
    const identity = await identityOf(groupId);
    const request = await beginDevicePairing(serverUrl, live.current.deviceName, identity, signal, { kind: 'nodeJoin', groupId, joinCode });
    const result = await pollUntilDone(request, signal);
    if (result.status !== 'approved' || !result.mesh?.nodeId || !result.mesh.nodePublicKey) throw new Error(t('mesh.joinCodeRejected'));
    const nodeId = result.mesh.nodeId;
    const nodePublicKey = result.mesh.nodePublicKey;
    const group = await editRoster(groupId, (chain, self) => ({
      members: [...chain.head.members.filter((member) => member.id !== nodeId),
        meshNodeMember({ publicKey: decodeBase64Url(nodePublicKey), name: hostOf(serverUrl), addedBy: self })],
    }));
    replaceGroup({ ...group, nodeUrls: { ...group.nodeUrls, [nodeId]: [serverUrl] } });
    const seed = await loadHistorySeed(meshHistoryKeyId(groupId));
    if (!seed) throw new Error(t('mesh.keyMissing'));
    const id = createRequestId('backend');
    await saveHistorySeed(id, seed);
    seed.fill(0);
    // The node admits this key until it receives the chain, which the first
    // sync pushes.
    live.current.addProfile({ id, name: hostOf(serverUrl), serverUrl, tenantId: 'local', mesh: { groupId, nodeId } });
    live.current.approveCredentials(id, {
      deviceSecret: identity.secretKey, encryptionProtocol: result.pin.encryptionProtocol,
      encryptionPublicKey: result.pin.encryptionPublicKey, transportVerified: true,
    });
  }, [editRoster, identityOf, replaceGroup]);

  /** Joins the group of `inviteText`: asks the first reachable node, then
   * waits until a device of the group approves. */
  const joinGroup = useCallback(async (inviteText: string) => {
    joinAbort.current?.abort();
    const controller = new AbortController();
    joinAbort.current = controller;
    const { signal } = controller;
    setJoinProgress({ status: 'connecting' });
    try {
      const invite = parseMeshInvite(inviteText);
      if (groupsRef.current.some((group) => group.groupId === invite.groupId)) throw new Error(t('mesh.alreadyMember'));
      const identity = generateDeviceIdentity();
      const historyKeys = generateHistoryRecipientKeyPair();
      let request: DevicePairingRequest | undefined;
      let reached: { nodeId: string; name: string; url: string } | undefined;
      let lastError: unknown;
      for (const node of invite.nodes) {
        for (const url of node.urls) {
          try {
            request = await beginDevicePairing(url, live.current.deviceName, identity, signal, { kind: 'deviceJoin', groupId: invite.groupId, historyKey: historyKeys.publicKey });
            reached = { nodeId: node.nodeId, name: node.name, url };
            break;
          } catch (error) {
            if (signal.aborted) throw error;
            lastError = error;
          }
        }
        if (request) break;
      }
      if (!request || !reached) throw lastError instanceof Error ? lastError : new Error(t('mesh.noNodeReachable'));
      setJoinProgress({ status: 'waiting', verificationCode: request.verificationCode, nodeName: reached.name, expiresAt: request.expiresAt });
      const result = await pollUntilDone(request, signal);
      if (result.status !== 'approved') throw new Error(t(result.status === 'rejected' ? 'mesh.joinRejected' : 'mesh.joinExpired'));
      await saveSecret(meshDeviceSecretKey(invite.groupId), identity.secretKey);
      await saveHistorySeed(meshHistoryKeyId(invite.groupId), historyKeys.secretKey);
      const id = createRequestId('backend');
      await saveHistorySeed(id, historyKeys.secretKey);
      historyKeys.secretKey.fill(0);
      replaceGroup({
        groupId: invite.groupId, name: invite.name, chain: [], nodeInfos: {}, nodeUrls: { [reached.nodeId]: [reached.url] },
        deviceId: identity.deviceId, joinedAt: Date.now(),
      });
      live.current.addProfile({ id, name: reached.name, serverUrl: reached.url, tenantId: 'local', mesh: { groupId: invite.groupId, nodeId: reached.nodeId } });
      live.current.approveCredentials(id, {
        deviceSecret: identity.secretKey, encryptionProtocol: result.pin.encryptionProtocol,
        encryptionPublicKey: result.pin.encryptionPublicKey, transportVerified: true,
      });
      setJoinProgress({ status: 'idle' });
    } catch (error) {
      if (signal.aborted) {
        setJoinProgress({ status: 'idle' });
        return;
      }
      setJoinProgress({ status: 'error', error: error instanceof Error ? error.message : t('mesh.joinFailed') });
    } finally {
      if (joinAbort.current === controller) joinAbort.current = null;
    }
  }, [replaceGroup]);

  const cancelJoin = useCallback(() => {
    joinAbort.current?.abort();
    setJoinProgress({ status: 'idle' });
  }, []);

  const approveJoin = useCallback(async (request: MeshJoinView) => {
    const identity = await identityOf(request.groupId);
    const member = meshMemberForJoinRequest(request, identity.deviceId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await syncProfile(request.profileId);
      const group = groupsRef.current.find((item) => item.groupId === request.groupId);
      const chain = group ? storedChain(group) : null;
      if (!group || !chain) throw new Error(t('mesh.groupMissing'));
      const docs = appendMeshRoster(chain, {
        signerSecretKey: decodeBase64Url(identity.secretKey),
        members: [...chain.head.members.filter((item) => item.id !== member.id), member],
      });
      try {
        await live.current.send(request.profileId, meshCommands.joinApprove(request.requestId, docs));
      } catch (error) {
        // The group changed meanwhile: approve again on the newest roster.
        if (attempt === 0 && (error as { code?: string }).code === 'CONFLICT') continue;
        throw error;
      }
      const next = { ...group, chain: docs };
      replaceGroup(next);
      await pushToAll(next);
      break;
    }
    setJoinRequests((current) => ({ ...current, [request.profileId]: (current[request.profileId] ?? []).filter((item) => item.requestId !== request.requestId) }));
  }, [identityOf, pushToAll, replaceGroup, syncProfile]);

  const rejectJoin = useCallback(async (request: MeshJoinView) => {
    await live.current.send(request.profileId, meshCommands.joinReject(request.requestId));
    setJoinRequests((current) => ({ ...current, [request.profileId]: (current[request.profileId] ?? []).filter((item) => item.requestId !== request.requestId) }));
  }, []);

  const removeMember = useCallback(async (groupId: string, memberId: string) => {
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    const removedProfile = profileOf(groupId, memberId);
    await editRoster(groupId, (chain) => {
      const members = chain.head.members.filter((member) => member.id !== memberId);
      if (!members.some((member) => member.kind === 'device')) throw new Error(t('mesh.lastDevice'));
      return { members };
    }, removedProfile ? [removedProfile.id] : []);
    if (group?.deviceId === memberId) await forgetGroup(groupId);
  }, [editRoster, forgetGroup]);

  /** Changes one node's roster entry: pinned addresses, relay role, or
   * whether it may be reached through a relay. */
  const updateNode = useCallback(async (groupId: string, nodeId: string, patch: { addresses?: string[]; relay?: MeshRelayRole; relayTarget?: boolean }) => {
    await editRoster(groupId, (chain) => ({
      members: chain.head.members.map((member) => {
        if (member.id !== nodeId || member.kind !== 'node') return member;
        const next: MeshMember = { ...member, ...patch };
        if (!next.addresses?.length) delete next.addresses;
        if (next.relay === 'allowed') delete next.relay;
        if (next.relayTarget !== false) delete next.relayTarget;
        return next;
      }),
    }));
  }, [editRoster]);

  /** Leaves the group; the last device dissolves it (every node leaves).
   * The group is forgotten once the final roster reached its nodes (every
   * node when dissolving, any one when other devices carry it on); until
   * then it stays as leaving, and the roster goes out again whenever a node
   * reconnects. `forgetLeavingGroup` gives up on that. */
  const leaveGroup = useCallback(async (groupId: string) => {
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    const chain = group ? storedChain(group) : null;
    if (!group || !chain) {
      await forgetGroup(groupId);
      return;
    }
    const otherDevices = chain.head.members.some((member) => member.kind === 'device' && member.id !== group.deviceId);
    const nodes = chain.head.members.filter((member) => member.kind === 'node').map((member) => ({ id: member.id, name: member.name }));
    const nodeProfiles = connectedProfiles(groupId).map((profile) => profile.id);
    let confirmed = new Set<string>();
    const next = await editRoster(groupId, (current, self) => ({
      members: otherDevices
        ? current.head.members.filter((member) => member.id !== self)
        : current.head.members.filter((member) => member.kind === 'device'),
    }), nodeProfiles, (pushed) => { confirmed = pushed; });
    replaceGroup({ ...next, leaving: startLeave(nodes, otherDevices, confirmed) });
    await settleLeave(groupId, null);
  }, [editRoster, forgetGroup, replaceGroup, settleLeave]);

  /** Forgets a group this device is still leaving without waiting for its
   * nodes: they keep the old roster (and this device in it) until another
   * device or the recovery key changes it. */
  const forgetLeavingGroup = useCallback(async (groupId: string) => {
    if (groupsRef.current.find((item) => item.groupId === groupId)?.leaving) await forgetGroup(groupId);
  }, [forgetGroup]);

  /** Pushes a leaving device's final roster to its unconfirmed nodes now. */
  const retryLeave = useCallback(async (groupId: string) => {
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    if (!group?.leaving) return;
    for (const profile of live.current.profiles) {
      if (profile.mesh?.groupId !== groupId || !group.leaving.pendingNodes.includes(profile.mesh.nodeId)) continue;
      if (live.current.links[profile.id]?.state === 'open') await syncProfile(profile.id);
      else retryNode(profile.id);
    }
  }, [retryNode, syncProfile]);

  /** The other devices of `profileId`'s group, each with the history key
   * the verified roster lists for it: their history grants for that key are
   * fulfilled without asking (approving the device covered history). */
  const autoGrantRecipients = useCallback((profileId: string): ReadonlyMap<string, string> => {
    const groupId = live.current.profiles.find((profile) => profile.id === profileId)?.mesh?.groupId;
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    const chain = group ? storedChain(group) : null;
    return new Map(chain ? chain.head.members.flatMap((member) => (
      member.kind === 'device' && member.id !== group!.deviceId && member.historyKey ? [[member.id, member.historyKey] as const] : []
    )) : []);
  }, []);

  const views = useMemo<MeshGroupView[]>(() => groups.map((group) => {
    const chain = storedChain(group);
    const infos = chain ? nodeInfosOf(group, chain) : new Map<string, MeshNodeInfo>();
    const reports = profiles.filter((item) => item.mesh?.groupId === group.groupId).flatMap((item) => (presence[item.id] ? [presence[item.id]] : []));
    const nameOf = (nodeId: string) => chain?.head.members.find((item) => item.id === nodeId)?.name ?? nodeId;
    const ipcNodes = new Set(Object.entries(ipcNodeIds)
      .filter(([profileId]) => profiles.some((item) => item.id === profileId && !item.disabled))
      .map(([, nodeId]) => nodeId));
    const members: MeshMemberView[] = (chain?.head.members ?? []).map((member) => {
      const profile = member.kind === 'node' ? profiles.find((item) => item.mesh?.groupId === group.groupId && item.mesh.nodeId === member.id) : undefined;
      const self = member.id === group.deviceId;
      const local = member.kind === 'node' && (isStandbyProfile(profile) || ipcNodes.has(member.id));
      const lastSeen = Math.max(0, ...reports.map((report) => report.lastSeen[member.id] ?? 0));
      return {
        ...member, self,
        ...(local ? { local } : {}),
        ...(profile ? { profileId: profile.id, state: links[profile.id]?.state ?? 'idle' } : {}),
        ...(profile?.mesh?.via ? { via: nameOf(profile.mesh.via) } : {}),
        ...(infos.get(member.id) ? { info: infos.get(member.id) } : {}),
        ...(member.kind === 'device' ? {
          online: self || reports.some((report) => report.connected.some((item) => item.deviceId === member.id)),
          ...(lastSeen ? { lastSeen } : {}),
        } : {}),
      };
    });
    const inviteNodes = members.filter((member) => member.kind === 'node').map((member) => ({
      nodeId: member.id, name: member.name, urls: nodeUrls(group, member.info, member.id, { pinned: member.addresses }),
    })).filter((node) => node.urls.length);
    const invite = { groupId: group.groupId, name: chain?.head.name ?? group.name, nodes: inviteNodes };
    const leaving = group.leaving ? {
      pendingNodes: group.leaving.pendingNodes.map((id) => {
        const profile = profiles.find((item) => item.mesh?.groupId === group.groupId && item.mesh.nodeId === id);
        return { id, name: group.leaving!.nodeNames[id] || profile?.name || id, state: (profile ? links[profile.id]?.state : undefined) ?? 'idle' };
      }),
    } : undefined;
    return {
      groupId: group.groupId, name: chain?.head.name ?? group.name, version: chain?.head.version ?? 0, deviceId: group.deviceId,
      members, pending: !chain,
      ...(leaving ? { leaving } : {}),
      invite: inviteNodes.length ? encodeMeshInvite(invite) : '',
      inviteQr: inviteNodes.length ? encodeMeshInviteForQr(invite) : null,
    };
  }), [groups, ipcNodeIds, links, presence, profiles]);

  const pendingRequests = useMemo<MeshJoinView[]>(() => Object.entries(joinRequests).flatMap(([profileId, requests]) => {
    const groupId = profiles.find((profile) => profile.id === profileId)?.mesh?.groupId;
    const group = views.find((view) => view.groupId === groupId);
    return group ? requests.map((request) => ({ ...request, profileId, groupName: group.name })) : [];
  }).filter((request, index, all) => all.findIndex((item) => item.requestId === request.requestId) === index)
    .filter((request) => request.expiresAt > Date.now()), [joinRequests, profiles, views]);

  return {
    loaded,
    groups: views,
    joinRequests: pendingRequests,
    joinProgress,
    createGroup,
    joinGroup,
    cancelJoin,
    addPairedBackend,
    addBackendWithCode,
    approveJoin,
    rejectJoin,
    removeMember,
    leaveGroup,
    retryLeave,
    forgetLeavingGroup,
    autoGrantRecipients,
    receiveEvent,
    ipcNodeIds,
    relayEnabled: prefs.relay,
    setRelayEnabled,
    retryNode,
    updateNode,
  };
}

export type MeshGroupsSession = ReturnType<typeof useMeshGroups>;
export { MESH_UPDATED_EVENT };

/** A node's addresses to try, best first: network ones only (an IPC socket
 * reaches this machine's backend, never a group node). */
function nodeUrls(...args: Parameters<typeof candidateUrls>): string[] {
  return candidateUrls(...args).filter(isMeshAddress);
}

function hostOf(serverUrl: string): string {
  try {
    return new URL(serverUrl).hostname || serverUrl;
  } catch {
    return serverUrl;
  }
}

/** Polls a pairing request until it is decided (transient failures back off). */
async function pollUntilDone(request: DevicePairingRequest, signal?: AbortSignal) {
  let approved = false;
  try {
    let delay = 0;
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (Date.now() >= request.expiresAt) return { status: 'expired' as const };
      if (delay) await abortableDelay(delay, signal);
      try {
        const result = await request.poll(signal);
        if (result.status === 'pending') {
          delay = delay ? (request.pollIntervalMs || PAIRING_POLL_INTERVAL_MS) : 300;
          continue;
        }
        approved = result.status === 'approved';
        return result;
      } catch (error) {
        if (!(error instanceof DevicePairingRetryableError)) throw error;
        delay = nextPairingPollDelayMs(delay || request.pollIntervalMs || PAIRING_POLL_INTERVAL_MS, error);
      }
    }
  } finally {
    if (!approved) await request.cancel().catch(() => undefined);
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

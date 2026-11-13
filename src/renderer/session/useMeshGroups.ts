import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeBase64Url, deviceIdentityFromSecret, generateDeviceIdentity, type DeviceIdentity } from '@todex/protocol/deviceAuth';
import { generateHistoryRecipientKeyPair } from '@todex/protocol/historyCrypto';
import {
  MESH_UPDATED_EVENT,
  appendMeshRoster,
  createMeshGenesis,
  encodeMeshInvite,
  meshCommands,
  meshMemberForJoinRequest,
  meshNodeMember,
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
  type MeshSignedDoc,
} from '@todex/protocol/mesh';
import { recoveryWordsFromSeed } from '@todex/protocol/recoveryKey';
import { createRequestId } from '@todex/protocol/todex';
import { t } from '../i18n';
import { loadJson, loadSecret, removeSecret, saveJson, saveSecret } from '../lib/storage';
import { deleteHistorySeed, loadHistorySeed, saveHistorySeed } from '../lib/historyKeyStore';
import type { BackendConnectionProfile } from './backendColors';
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
  candidateUrls,
  mergeNodeState,
  meshDeviceSecretKey,
  meshHistoryKeyId,
  nodeInfosOf,
  normalizeStoredMeshGroups,
  rememberUrl,
  storedChain,
  type StoredMeshGroup,
} from './meshGroups';

// Device groups on this client (TodeX_backend docs/mesh-v1.md). Every node of
// a group gets a backend profile (`profile.mesh`) signed with the group's
// member key and decrypting with the group's history key, so the rest of the
// session treats it like any paired backend. On each connect the node's
// group state is read and merged (the roster chain under the fork rule, node
// infos), and pushed back when the node is behind; `mesh.updated` re-reads.
// Join requests of every connected node are listed for approval here; an
// approval appends the new device to the roster, so the node lets it in.

export type MeshPairingCredentials = Pick<BackendConnectionProfile, 'deviceSecret' | 'encryptionProtocol' | 'encryptionPublicKey' | 'transportVerified'>;

export type MeshLink = { state: ConnectionState; mesh: boolean | undefined };

export type MeshMemberView = MeshMember & {
  self: boolean;
  /** Node members: their profile and its connection state. */
  profileId?: string;
  state?: ConnectionState;
  info?: MeshNodeInfo;
};

export type MeshGroupView = {
  groupId: string;
  name: string;
  version: number;
  deviceId: string;
  members: MeshMemberView[];
  /** Waiting for the first roster after joining. */
  pending: boolean;
  invite: string;
};

export type MeshJoinView = MeshJoinRequest & { profileId: string; groupName: string };

export type MeshJoinProgress =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'waiting'; verificationCode: string; nodeName: string; expiresAt: number }
  | { status: 'error'; error: string };

type HistoryGrantActions = {
  /** Re-wraps this profile's history for `deviceId`'s pending grant, if any. */
  authorizeDevice: (profileId: string, deviceId: string) => Promise<void>;
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

  /** Sends the group's chain and node infos to every connected node of it. */
  const pushToAll = useCallback(async (group: StoredMeshGroup, extraProfileIds: string[] = []) => {
    const ids = new Set([...connectedProfiles(group.groupId).map((profile) => profile.id), ...extraProfileIds]);
    const infos = Object.values(group.nodeInfos);
    await Promise.all([...ids].map((profileId) => live.current.send(profileId, meshCommands.statePush(group.chain, infos)).catch(() => undefined)));
  }, []);

  /** Forgets a group this device left or was removed from: its profiles,
   * keys and record. */
  const forgetGroup = useCallback(async (groupId: string) => {
    for (const profile of live.current.profiles) {
      if (profile.mesh?.groupId === groupId) live.current.removeProfile(profile.id);
    }
    setGroups(groupsRef.current.filter((item) => item.groupId !== groupId));
    setJoinRequests((current) => Object.fromEntries(Object.entries(current).filter(([profileId]) => live.current.profiles.find((profile) => profile.id === profileId)?.mesh?.groupId !== groupId)));
    await removeSecret(meshDeviceSecretKey(groupId)).catch(() => undefined);
    await deleteHistorySeed(meshHistoryKeyId(groupId)).catch(() => undefined);
  }, [setGroups]);

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
      const state = parseMeshNodeState(await live.current.send(profileId, meshCommands.stateGet()));
      if (state.nodeId !== profile.mesh.nodeId) {
        // The invite named the node; the node's own answer wins.
        live.current.updateProfile(profileId, { mesh: { groupId: stored.groupId, nodeId: state.nodeId } });
      }
      const remote = state.groups.find((item) => item.groupId === stored.groupId);
      const outcome = mergeNodeState(stored, { nodeId: state.nodeId, nodeInfo: state.nodeInfo, chain: remote?.chain, nodeInfos: remote?.nodeInfos });
      let group = outcome.group;
      const remembered = rememberUrl(group, state.nodeId, profile.serverUrl);
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
    })().catch(() => undefined).finally(() => { syncing.current.delete(profileId); });
    syncing.current.set(profileId, run);
    return run;
  }, [forgetGroup, replaceGroup]);

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
  const receiveEvent = useCallback((profileId: string, _payload: unknown) => {
    if (live.current.profiles.find((profile) => profile.id === profileId)?.mesh) void syncProfile(profileId);
  }, [syncProfile]);

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
        const url = candidateUrls(group, info, member.id)[0];
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
            live.current.addProfile({ id, name: member.name, serverUrl: url, tenantId: 'local', mesh: { groupId: group.groupId, nodeId: member.id } });
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
  }, [groups, identityOf, loaded, profiles]);

  // A node that stays unreachable is tried at its next known address.
  const failing = useRef(new Map<string, { since: number; rotatedAt: number }>());
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const profile of live.current.profiles) {
        if (!profile.mesh || profile.disabled) continue;
        const state = live.current.links[profile.id]?.state;
        if (state === 'open' || state === 'connecting' || state === undefined) {
          if (state === 'open') failing.current.delete(profile.id);
          continue;
        }
        const entry = failing.current.get(profile.id) ?? { since: now, rotatedAt: 0 };
        failing.current.set(profile.id, entry);
        if (now - entry.since < 15_000 || now - entry.rotatedAt < 15_000) continue;
        const group = groupsRef.current.find((item) => item.groupId === profile.mesh!.groupId);
        const chain = group ? storedChain(group) : null;
        if (!group || !chain) continue;
        const urls = candidateUrls(group, nodeInfosOf(group, chain).get(profile.mesh.nodeId), profile.mesh.nodeId);
        if (urls.length < 2) continue;
        const next = urls[(urls.indexOf(profile.serverUrl) + 1) % urls.length];
        entry.rotatedAt = now;
        const credentials = {
          deviceSecret: profile.deviceSecret, encryptionProtocol: profile.encryptionProtocol,
          encryptionPublicKey: profile.encryptionPublicKey, transportVerified: profile.transportVerified,
        };
        live.current.updateProfile(profile.id, { serverUrl: next, ...credentials });
        live.current.approveCredentials(profile.id, credentials);
      }
    };
    const timer = setInterval(check, 5_000);
    return () => clearInterval(timer);
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
  const editRoster = useCallback(async (groupId: string, edit: (chain: MeshChain, self: string) => { members?: MeshMember[]; name?: string }, extraProfileIds: string[] = []) => {
    for (const profile of connectedProfiles(groupId)) await syncProfile(profile.id);
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    const chain = group ? storedChain(group) : null;
    if (!group || !chain) throw new Error(t('mesh.groupMissing'));
    const identity = await identityOf(groupId);
    const docs = appendMeshRoster(chain, { signerSecretKey: decodeBase64Url(identity.secretKey), ...edit(chain, identity.deviceId) });
    const next = { ...group, chain: docs, name: edit(chain, identity.deviceId).name ?? group.name };
    await pushToAll(next, extraProfileIds);
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
    const withInfo = { ...group, nodeInfos: { ...group.nodeInfos, [nodeId]: nodeInfoDoc }, nodeUrls: { ...group.nodeUrls, [nodeId]: [profile.serverUrl] } };
    replaceGroup(withInfo);
    // The node opened a grant for the group key: this profile's own history
    // key still opens everything, so it re-wraps before switching keys.
    await live.current.history.authorizeDevice(profileId, identity.deviceId);
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

  /** Leaves the group; the last device dissolves it (every node leaves). */
  const leaveGroup = useCallback(async (groupId: string) => {
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    const chain = group ? storedChain(group) : null;
    if (group && chain) {
      const otherDevices = chain.head.members.some((member) => member.kind === 'device' && member.id !== group.deviceId);
      const nodeProfiles = connectedProfiles(groupId).map((profile) => profile.id);
      await editRoster(groupId, (current, self) => ({
        members: otherDevices
          ? current.head.members.filter((member) => member.id !== self)
          : current.head.members.filter((member) => member.kind === 'device'),
      }), nodeProfiles);
    }
    await forgetGroup(groupId);
  }, [editRoster, forgetGroup]);

  /** Device ids of `profileId`'s group: their history grants are fulfilled
   * without asking (approving the device covered history). */
  const autoGrantDeviceIds = useCallback((profileId: string): ReadonlySet<string> => {
    const groupId = live.current.profiles.find((profile) => profile.id === profileId)?.mesh?.groupId;
    const group = groupsRef.current.find((item) => item.groupId === groupId);
    const chain = group ? storedChain(group) : null;
    return new Set(chain ? chain.head.members.filter((member) => member.kind === 'device' && member.id !== group!.deviceId).map((member) => member.id) : []);
  }, []);

  const views = useMemo<MeshGroupView[]>(() => groups.map((group) => {
    const chain = storedChain(group);
    const infos = chain ? nodeInfosOf(group, chain) : new Map<string, MeshNodeInfo>();
    const members: MeshMemberView[] = (chain?.head.members ?? []).map((member) => {
      const profile = member.kind === 'node' ? profiles.find((item) => item.mesh?.groupId === group.groupId && item.mesh.nodeId === member.id) : undefined;
      return {
        ...member, self: member.id === group.deviceId,
        ...(profile ? { profileId: profile.id, state: links[profile.id]?.state ?? 'idle' } : {}),
        ...(infos.get(member.id) ? { info: infos.get(member.id) } : {}),
      };
    });
    const inviteNodes = members.filter((member) => member.kind === 'node').map((member) => ({
      nodeId: member.id, name: member.name, urls: candidateUrls(group, member.info, member.id),
    })).filter((node) => node.urls.length);
    return {
      groupId: group.groupId, name: chain?.head.name ?? group.name, version: chain?.head.version ?? 0, deviceId: group.deviceId,
      members, pending: !chain, invite: inviteNodes.length ? encodeMeshInvite({ groupId: group.groupId, name: chain?.head.name ?? group.name, nodes: inviteNodes }) : '',
    };
  }), [groups, links, profiles]);

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
    autoGrantDeviceIds,
    receiveEvent,
  };
}

export type MeshGroupsSession = ReturnType<typeof useMeshGroups>;
export { MESH_UPDATED_EVENT };

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

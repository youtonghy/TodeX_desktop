// Demo preview (`?demo&mesh=1`): a device group with this device, a second
// device and the demo backend as its node, plus a device asking to join.
// Every key is fixed, so the signed roster and the screenshots are stable.
import { ed25519 } from '@noble/curves/ed25519.js';
import { encodeBase64Url } from '@todex/protocol/deviceAuth';
import { historyRecipientKeyPairFromSeed } from '@todex/protocol/historyCrypto';
import {
  MESH_NODE_INFO_DOMAIN,
  appendMeshRoster,
  createMeshGenesis,
  meshDeviceMember,
  meshNodeMember,
  signMeshDoc,
  verifyMeshChain,
  type MeshJoinRequest,
  type MeshSignedDoc,
} from '@todex/protocol/mesh';
import type { StoredMeshGroup } from '../session/meshGroups';

const NOW = Date.UTC(2026, 10, 1, 9, 0);
const seed = (byte: number) => new Uint8Array(32).fill(byte);
const history = (byte: number) => historyRecipientKeyPairFromSeed(seed(byte)).publicKey;

/** This device's group key (base64url Ed25519 seed). */
export const DEMO_MESH_DEVICE_SECRET = encodeBase64Url(seed(0x31));

export type DemoMesh = {
  group: StoredMeshGroup;
  nodeId: string;
  nodeInfo: MeshSignedDoc;
  joinRequest: MeshJoinRequest;
};

let built: DemoMesh | null = null;

export function demoMesh(serverUrl: string): DemoMesh {
  if (built) return built;
  const genesis = createMeshGenesis({
    name: '家里', creatorSecretKey: seed(0x31), creatorName: 'MacBook Pro', creatorHistoryKey: history(0x31), now: NOW, nonce: new Uint8Array(16).fill(7),
  });
  const base = verifyMeshChain(genesis);
  const self = base.head.members[0];
  const nodeKey = ed25519.getPublicKey(seed(0x39));
  const node = meshNodeMember({ publicKey: nodeKey, name: 'MBP', addedBy: self.id, addedAt: NOW + 1 });
  const phone = meshDeviceMember({ publicKey: ed25519.getPublicKey(seed(0x32)), name: 'iPhone', historyKey: history(0x32), addedBy: self.id, addedAt: NOW + 2 });
  const chain = appendMeshRoster(base, { signerSecretKey: seed(0x31), members: [self, node, phone], now: NOW + 2 });
  const nodeInfo = signMeshDoc(MESH_NODE_INFO_DOMAIN, {
    type: 'todex.mesh.node-info', v: 1, nodeId: node.id, publicKey: node.publicKey, seq: NOW, name: 'MBP',
    transportProtocol: 'none', transportPublicKey: '', urls: [serverUrl], signedAt: NOW,
  }, seed(0x39));
  const groupId = base.groupId;
  const joiner = ed25519.getPublicKey(seed(0x33));
  const joinerMember = meshDeviceMember({ publicKey: joiner, name: 'Pixel 9', historyKey: history(0x33), addedAt: NOW });
  built = {
    nodeId: node.id,
    nodeInfo,
    group: {
      groupId, name: '家里', chain, nodeInfos: { [node.id]: nodeInfo }, nodeUrls: { [node.id]: [serverUrl] },
      deviceId: self.id, joinedAt: NOW,
    },
    joinRequest: {
      requestId: '7b3c4d5e-1f20-4a3b-8c4d-5e6f7a8b9c0d', groupId, verificationCode: '3F9A2-7C41B', deviceName: 'Pixel 9',
      deviceId: joinerMember.id, devicePublicKey: joinerMember.publicKey, historyKey: joinerMember.historyKey!,
      peerAddress: '192.168.1.42', expiresAt: Date.now() + 3_600_000,
    },
  };
  return built;
}

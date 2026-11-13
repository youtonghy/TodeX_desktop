// Device groups (TodeX_backend docs/mesh-v1.md) on this client: where the
// group records and keys are stored. The record logic is shared
// (`@todex/protocol/meshClient`); useMeshGroups drives it.

import { platform } from '../platform';

export * from '@todex/protocol/meshClient';

export const MESH_GROUPS_STORAGE_KEY = `${platform.storagePrefix}.meshGroups.v1`;
/** The group member key (base64url Ed25519 seed), one per group. */
export const meshDeviceSecretKey = (groupId: string) => `${platform.storagePrefix}.meshDevice.v1.${groupId}`;
/** The id the group's history key is stored under (history key store keys
 * by profile id; the group is not a profile). */
export const meshHistoryKeyId = (groupId: string) => `mesh-${groupId}`;

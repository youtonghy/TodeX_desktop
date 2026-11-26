import type { V2ApiClient } from '@todex/protocol/v2';
import { mapHostPathToBackend } from '@todex/protocol/pathMapping';
import {
  PROMPT_LINK_FINGERPRINT_BYTES,
  PROMPT_UPLOAD_CHUNK_BYTES,
  PROMPT_UPLOAD_MAX_BYTES,
  promptLinkFingerprint,
  type PromptUploadChunkResult,
} from '@todex/protocol/promptUploads';
import { t } from '../i18n';
import { linkLocalFile, type HostPathContext } from './hostPaths';

/** Uploads a composer attachment to the backend (`PUT /v2/uploads`) in raw
 * chunks and returns where it was stored on the backend's machine.
 * `conversationId` (a private conversation's backend id) stores it in that
 * conversation's private folder. `stillWanted`, checked before every chunk,
 * stops the upload once it returns false (the conversation was deleted). */
export async function uploadPromptFile(
  api: V2ApiClient,
  name: string,
  blob: Blob,
  conversationId?: string,
  stillWanted?: () => boolean,
): Promise<PromptUploadChunkResult> {
  if (blob.size > PROMPT_UPLOAD_MAX_BYTES) throw new Error(t('chat.uploadTooLarge', { name }));
  let offset = 0;
  let result: PromptUploadChunkResult | undefined;
  do {
    if (stillWanted && !stillWanted()) throw new Error(t('private.uploadConversationGone'));
    const end = Math.min(offset + PROMPT_UPLOAD_CHUNK_BYTES, blob.size);
    const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    result = await api.uploadPromptChunk(name, offset, bytes, result?.uploadId, undefined, conversationId);
    offset = end;
  } while (offset < blob.size);
  return result;
}

/** A composer file that is on this machine's disk, and how this machine's
 * paths relate to the backend's. */
export type LocalPromptFile = { hostPath: string; context: HostPathContext };

/** {@link uploadPromptFile}, except that a file on the backend's own machine
 * is linked in place (`POST /v2/uploads/link`) instead of copied; `linked`
 * tells which happened. Anything that keeps the backend from reading the
 * file in place falls back to the upload. */
export async function linkOrUploadPromptFile(
  api: V2ApiClient,
  name: string,
  blob: Blob,
  local: LocalPromptFile | undefined,
  conversationId?: string,
  stillWanted?: () => boolean,
): Promise<PromptUploadChunkResult & { linked: boolean }> {
  if (local) {
    if (stillWanted && !stillWanted()) throw new Error(t('private.uploadConversationGone'));
    const linked = await linkLocalFile({
      link: (request) => api.linkPromptFile(request),
      fingerprint: promptLinkFingerprint,
      fingerprintBytes: PROMPT_LINK_FINGERPRINT_BYTES,
      mapHostPathToBackend,
    }, local.context, { hostPath: local.hostPath, blob, conversationId });
    if (linked) return { ...linked, linked: true };
  }
  return { ...await uploadPromptFile(api, name, blob, conversationId, stillWanted), linked: false };
}

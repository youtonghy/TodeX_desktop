import type { V2ApiClient } from '@todex/protocol/v2';
import { PROMPT_UPLOAD_CHUNK_BYTES, PROMPT_UPLOAD_MAX_BYTES, type PromptUploadChunkResult } from '@todex/protocol/promptUploads';
import { t } from '../i18n';

/** Uploads a composer attachment to the backend (`PUT /v2/uploads`) in raw
 * chunks and returns where it was stored on the backend's machine.
 * `conversationId` (a private conversation's backend id) stores it in that
 * conversation's private folder. */
export async function uploadPromptFile(api: V2ApiClient, name: string, blob: Blob, conversationId?: string): Promise<PromptUploadChunkResult> {
  if (blob.size > PROMPT_UPLOAD_MAX_BYTES) throw new Error(t('chat.uploadTooLarge', { name }));
  let offset = 0;
  let result: PromptUploadChunkResult | undefined;
  do {
    const end = Math.min(offset + PROMPT_UPLOAD_CHUNK_BYTES, blob.size);
    const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    result = await api.uploadPromptChunk(name, offset, bytes, result?.uploadId, undefined, conversationId);
    offset = end;
  } while (offset < blob.size);
  return result;
}

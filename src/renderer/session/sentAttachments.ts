import { canonicalConversationEventType, type ConversationEvent } from '@todex/protocol/v2';
import { t } from '../i18n';

export type SentAttachment = {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  previewUrl?: string;
  /** Text payloads stay with the receipt so sent files can be re-previewed. */
  textContent?: string;
};

export type SentAttachmentRecord = {
  conversationId: string;
  requestId: string;
  eventId?: string;
  turnId?: string;
  text: string;
  attachments: SentAttachment[];
  /** Read back from storage, which keeps only the ids: `text` and
   * `attachments` are empty until the message is read from history again
   * (`attachmentsFromRequestContent`). */
  restored?: true;
};

/** What is stored of a receipt: which message it belongs to, never its text,
 * file names or previews (those stay in the encrypted history). */
export type StoredSentAttachmentRecord = Pick<SentAttachmentRecord, 'conversationId' | 'requestId' | 'eventId' | 'turnId'>;

export function storedSentAttachmentRecords(records: readonly SentAttachmentRecord[]): StoredSentAttachmentRecord[] {
  return records.map(({ conversationId, requestId, eventId, turnId }) => ({
    conversationId, requestId, ...(eventId ? { eventId } : {}), ...(turnId ? { turnId } : {}),
  }));
}

/** Receipts read from storage, as content-less records. `hadContent` is set
 * when an older build stored their text or previews, which the caller then
 * overwrites. */
export function restoreSentAttachmentRecords(stored: unknown): { records: SentAttachmentRecord[]; hadContent: boolean } {
  if (!Array.isArray(stored)) return { records: [], hadContent: false };
  let hadContent = false;
  const records = stored.flatMap((value): SentAttachmentRecord[] => {
    const item = object(value);
    if ('text' in item || 'attachments' in item) hadContent = true;
    if (typeof item.conversationId !== 'string' || !item.conversationId || typeof item.requestId !== 'string' || !item.requestId) return [];
    return [{
      conversationId: item.conversationId, requestId: item.requestId,
      ...(typeof item.eventId === 'string' ? { eventId: item.eventId } : {}),
      ...(typeof item.turnId === 'string' ? { turnId: item.turnId } : {}),
      text: '', attachments: [], restored: true,
    }];
  });
  return { records: pruneSentAttachmentRecords(records), hadContent };
}

type AttachmentDraft = Omit<SentAttachment, 'previewUrl' | 'kind'> & { kind: 'image' | 'file' | 'reference' | 'text'; dataUrl: string };
const MAX_PREVIEW_LENGTH = 100 * 1024;

/** Oversized text still previews, truncated to the shared preview budget. */
function capText(text: string): string {
  return text.length > MAX_PREVIEW_LENGTH ? text.slice(0, MAX_PREVIEW_LENGTH) : text;
}

async function imagePreview(dataUrl: string): Promise<string | undefined> {
  if (!/^data:image\//i.test(dataUrl) || typeof Image === 'undefined' || typeof document === 'undefined') return undefined;
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        image.onload = null;
        image.onerror = null;
        reject(new Error('Image decoding timed out'));
      }, 5000);
      image.onload = () => { clearTimeout(timeout); resolve(); };
      image.onerror = () => { clearTimeout(timeout); reject(new Error('Image could not be decoded')); };
    });
    image.src = dataUrl;
    await loaded;
    if (!image.naturalWidth || !image.naturalHeight) return undefined;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    // Limit the encoded URL itself, so the persisted JSON also stays small.
    for (const longestEdge of [640, 480, 320, 160]) {
      const scale = Math.min(1, longestEdge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const preview = canvas.toDataURL('image/webp', 0.75);
      if (/^data:image\/(webp|png);base64,/.test(preview) && preview.length <= MAX_PREVIEW_LENGTH) return preview;
    }
  } catch { /* A broken image must still leave a visible attachment receipt. */ }
  return undefined;
}

export async function prepareSentAttachments(drafts: readonly AttachmentDraft[]): Promise<SentAttachment[]> {
  return Promise.all(drafts.map(async ({ id, kind, name, mimeType, sizeBytes, dataUrl, textContent }) => {
    const previewUrl = kind === 'image' ? await imagePreview(dataUrl) : undefined;
    // References surface as plain file receipts; their text stays in the message.
    const sentKind = kind === 'image' ? 'image' : 'file';
    return {
      id, kind: sentKind, name, mimeType, sizeBytes,
      ...(previewUrl ? { previewUrl } : {}),
      ...(sentKind === 'file' && textContent ? { textContent: capText(textContent) } : {}),
    };
  }));
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function bindSentAttachmentEvents(
  records: SentAttachmentRecord[], conversationId: string, events: readonly ConversationEvent[],
): SentAttachmentRecord[] {
  let changed = false;
  const next = records.map(record => {
    if (record.conversationId !== conversationId) return record;
    const event = events.find(candidate => {
      if (canonicalConversationEventType(candidate) !== 'message.created') return false;
      const payload = object(candidate.payload);
      const role = payload.role ?? object(payload.message).role;
      return (role === 'user' || role === 'human')
        && (payload.clientRequestId ?? payload.requestId) === record.requestId;
    });
    if (!event) return record;
    const payload = object(event.payload);
    const turnId = typeof payload.turnId === 'string' ? payload.turnId : record.turnId;
    if (record.eventId === event.eventId && record.turnId === turnId) return record;
    changed = true;
    return { ...record, eventId: event.eventId, ...(turnId ? { turnId } : {}) };
  });
  return changed ? next : records;
}

type TimelineIdentity = {
  id: string;
  kind: string;
  conversationId?: string;
  requestId?: string;
  turnId?: string;
  subtitle: string;
  raw?: string;
};

/** Attachments of a prompt's `content` items: the v2 request a user message
 * carries (`retryRequest.content`) or a legacy/native payload. */
export function attachmentsFromRequestContent(entryId: string, content: readonly unknown[]): SentAttachment[] {
  const attachments: SentAttachment[] = [];
  const imageName = () => t('sess.imageAttachmentName', { count: attachments.filter(attachment => attachment.kind === 'image').length + 1 });
  for (const value of content) {
    const item = object(value);
    const id = `${entryId}:attachment:${attachments.length}`;
    if (item.type === 'image') {
      const url = typeof item.url === 'string' ? item.url
        : typeof item.data === 'string' && typeof item.mimeType === 'string' ? `data:${item.mimeType};base64,${item.data}` : '';
      const match = /^data:(image\/(?:png|jpeg|gif|webp|avif|bmp));base64,[A-Za-z0-9+/]+={0,2}$/i.exec(url);
      if (!match) continue;
      attachments.push({ id, kind: 'image', name: imageName(), mimeType: match[1].toLowerCase(), sizeBytes: null, previewUrl: url });
    } else if (item.type === 'localImage' && typeof item.path === 'string') {
      attachments.push({ id, kind: 'image', name: item.path.split(/[\\/]/).pop() || imageName(), mimeType: 'image/*', sizeBytes: null });
    } else if (item.type === 'file' && typeof item.path === 'string') {
      attachments.push({ id, kind: 'file', name: typeof item.name === 'string' && item.name ? item.name : item.path.split(/[\\/]/).pop() || item.path, mimeType: 'application/octet-stream', sizeBytes: null });
    } else if (item.type === 'text' && typeof item.text === 'string') {
      const match = /^\[(附件|引用): ([^\r\n\]]+)\]\n/.exec(item.text);
      if (!match) continue;
      // attachmentTextBlock() appends "Content:\n<text>"; a plain text file
      // follows its header line directly.
      const body = /\nContent:\n([\s\S]*)$/.exec(item.text)?.[1] ?? (match[1] === '附件' && !/\nMIME: /.test(item.text) ? item.text.slice(match[0].length) : undefined);
      attachments.push({ id, kind: 'file', name: match[2], mimeType: 'text/plain', sizeBytes: null,
        ...(body ? { textContent: capText(body) } : {}) });
    }
  }
  return attachments;
}

/** Read attachments only from this message's own legacy/native payload. */
function attachmentsFromMessageRaw(entry: TimelineIdentity): SentAttachment[] {
  if (!entry.raw) return [];
  try {
    const message = object(JSON.parse(entry.raw));
    const content = message.type === 'userMessage' ? message.content
      : message.type === 'codex.local.turn' ? object(message.payload).input : undefined;
    return Array.isArray(content) ? attachmentsFromRequestContent(entry.id, content) : [];
  } catch {
    return [];
  }
}

export function projectSentAttachments<T extends TimelineIdentity>(
  timeline: readonly T[], records: readonly SentAttachmentRecord[], conversationId: string,
): Array<T & { sentAttachments?: SentAttachment[] }> {
  const scoped = records.filter(record => record.conversationId === conversationId);
  return timeline.map(entry => {
    if (entry.kind !== 'outgoing' || entry.conversationId !== conversationId) return entry;
    const exact = scoped.filter(record => record.eventId === entry.id
      || (entry.requestId !== undefined && record.requestId === entry.requestId)
      || record.requestId === entry.id);
    const record = exact.length === 1 && !exact[0].restored ? exact[0] : undefined;
    if (record) return { ...entry, subtitle: record.text, sentAttachments: record.attachments };
    const recovered = attachmentsFromMessageRaw(entry);
    return recovered.length ? { ...entry, sentAttachments: recovered } : entry;
  });
}

/** Records are ordered oldest first. Keep recent receipts and evict older previews first. */
export function pruneSentAttachmentRecords(records: readonly SentAttachmentRecord[]): SentAttachmentRecord[] {
  let remaining = 2 * 1024 * 1024;
  return records.filter(record => record && typeof record === 'object'
    && typeof record.conversationId === 'string' && Boolean(record.conversationId)
    && typeof record.requestId === 'string' && Boolean(record.requestId)
    && typeof record.text === 'string' && Array.isArray(record.attachments))
    .slice(-150).reverse().map(record => ({
    conversationId: record.conversationId,
    requestId: record.requestId,
    text: record.text,
    ...(typeof record.eventId === 'string' ? { eventId: record.eventId } : {}),
    ...(typeof record.turnId === 'string' ? { turnId: record.turnId } : {}),
    ...(record.restored ? { restored: true as const } : {}),
    attachments: record.attachments.filter(attachment => attachment && typeof attachment === 'object'
      && typeof attachment.id === 'string' && (attachment.kind === 'image' || attachment.kind === 'file')
      && typeof attachment.name === 'string' && typeof attachment.mimeType === 'string'
      && (attachment.sizeBytes === null || (typeof attachment.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes) && attachment.sizeBytes >= 0)))
      .map(attachment => {
      const { id, kind, name, mimeType, sizeBytes } = attachment;
      const metadata: SentAttachment = { id, kind, name, mimeType, sizeBytes };
      const textContent = attachment.textContent;
      const kept = typeof textContent === 'string' && textContent
        && textContent.length <= MAX_PREVIEW_LENGTH && textContent.length <= remaining
        ? (remaining -= textContent.length, { ...metadata, textContent })
        : metadata;
      const previewUrl = attachment.previewUrl;
      if (kind === 'image' && typeof previewUrl === 'string'
        && /^data:image\/(webp|png);base64,[A-Za-z0-9+/]*={0,2}$/.test(previewUrl)
        && previewUrl.length <= MAX_PREVIEW_LENGTH && previewUrl.length <= remaining) {
        remaining -= previewUrl.length;
        return { ...kept, previewUrl };
      }
      return kept;
    }),
  })).reverse();
}

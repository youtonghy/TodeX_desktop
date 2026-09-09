import { canonicalConversationEventType, type ConversationEvent } from '@todex/protocol/v2';

export type SentAttachment = {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  previewUrl?: string;
};

export type SentAttachmentRecord = {
  conversationId: string;
  requestId: string;
  eventId?: string;
  turnId?: string;
  text: string;
  attachments: SentAttachment[];
};

type AttachmentDraft = Omit<SentAttachment, 'previewUrl'> & { dataUrl: string };
const MAX_PREVIEW_LENGTH = 100 * 1024;

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
  return Promise.all(drafts.map(async ({ id, kind, name, mimeType, sizeBytes, dataUrl }) => {
    const previewUrl = kind === 'image' ? await imagePreview(dataUrl) : undefined;
    return { id, kind, name, mimeType, sizeBytes, ...(previewUrl ? { previewUrl } : {}) };
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

/** Read attachments only from this message's own legacy/native payload. */
function attachmentsFromMessageRaw(entry: TimelineIdentity): SentAttachment[] {
  if (!entry.raw) return [];
  try {
    const message = object(JSON.parse(entry.raw));
    const content = message.type === 'userMessage' ? message.content
      : message.type === 'codex.local.turn' ? object(message.payload).input : undefined;
    if (!Array.isArray(content)) return [];
    const attachments: SentAttachment[] = [];
    for (const value of content) {
      const item = object(value);
      if (item.type === 'image' && typeof item.url === 'string') {
        const match = /^data:(image\/(?:png|jpeg|gif|webp|avif|bmp));base64,[A-Za-z0-9+/]+={0,2}$/i.exec(item.url);
        if (!match) continue;
        attachments.push({
          id: `${entry.id}:attachment:${attachments.length}`, kind: 'image',
          name: `图片 ${attachments.filter(attachment => attachment.kind === 'image').length + 1}`,
          mimeType: match[1].toLowerCase(), sizeBytes: null, previewUrl: item.url,
        });
      } else if (item.type === 'text' && typeof item.text === 'string') {
        const match = /^\[附件: ([^\r\n\]]+)\]\n/.exec(item.text);
        if (!match) continue;
        attachments.push({ id: `${entry.id}:attachment:${attachments.length}`, kind: 'file',
          name: match[1], mimeType: 'text/plain', sizeBytes: null });
      }
    }
    return attachments;
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
    const record = exact.length === 1 ? exact[0] : undefined;
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
    attachments: record.attachments.filter(attachment => attachment && typeof attachment === 'object'
      && typeof attachment.id === 'string' && (attachment.kind === 'image' || attachment.kind === 'file')
      && typeof attachment.name === 'string' && typeof attachment.mimeType === 'string'
      && (attachment.sizeBytes === null || (typeof attachment.sizeBytes === 'number' && Number.isFinite(attachment.sizeBytes) && attachment.sizeBytes >= 0)))
      .map(attachment => {
      const { id, kind, name, mimeType, sizeBytes } = attachment;
      const metadata: SentAttachment = { id, kind, name, mimeType, sizeBytes };
      const previewUrl = attachment.previewUrl;
      if (kind === 'image' && typeof previewUrl === 'string'
        && /^data:image\/(webp|png);base64,[A-Za-z0-9+/]*={0,2}$/.test(previewUrl)
        && previewUrl.length <= MAX_PREVIEW_LENGTH && previewUrl.length <= remaining) {
        remaining -= previewUrl.length;
        return { ...metadata, previewUrl };
      }
      return metadata;
    }),
  })).reverse();
}

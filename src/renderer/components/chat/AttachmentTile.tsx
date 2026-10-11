import { useState } from 'react';
import { RiFileTextLine, RiImageLine } from '@remixicon/react';
import { useT } from '@/i18n';
import { formatBytes } from '@/session/helpers';
import type { SentAttachment } from '@/session/sentAttachments';
import { cx } from '@/utils/cx';
import { SentAttachmentPreview } from '../SentAttachmentPreview';

/**
 * The 56px attachment tile from the BoardUI composer panel: the thumbnail
 * for images, otherwise a file glyph with the name underneath. It is a
 * button that opens the attachment's preview.
 */
export function AttachmentTile({ name, image = false, src, sizeBytes, onOpen, className }: {
  name: string;
  image?: boolean;
  /** Thumbnail for image tiles. */
  src?: string;
  sizeBytes?: number | null;
  onOpen?: () => void;
  className?: string;
}) {
  const Glyph = image ? RiImageLine : RiFileTextLine;
  const size = sizeBytes && sizeBytes > 0 ? formatBytes(sizeBytes) : '';
  return (
    <button
      type="button"
      title={size ? `${name} · ${size}` : name}
      aria-label={name}
      onClick={onOpen}
      className={cx(
        'relative size-14 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-composer-panel-tile-border bg-background-primary-default',
        'transition-colors duration-150 ease hover:border-border-button-hover',
        'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        className,
      )}
    >
      {image && src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <>
          <Glyph aria-hidden className="absolute start-1.5 top-1.5 size-5 text-foreground-icon-secondary" />
          <span className="absolute inset-x-1.5 bottom-1 truncate text-start text-caption-2-medium text-text-secondary">{name}</span>
        </>
      )}
    </button>
  );
}

/// Sent attachments open a read-only preview on click/Enter; content comes
/// from the receipt (previewUrl / textContent captured at send time).
export function SentAttachmentList({ attachments }: { attachments: SentAttachment[] }) {
  const t = useT();
  const [preview, setPreview] = useState<SentAttachment | null>(null);
  return (
    <>
      <ul aria-label={t('chat.sentAttachments')} className="flex flex-wrap justify-end gap-2">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <AttachmentTile
              name={attachment.name}
              image={attachment.kind === 'image'}
              src={attachment.previewUrl}
              sizeBytes={attachment.sizeBytes}
              onOpen={() => setPreview(attachment)}
            />
          </li>
        ))}
      </ul>
      <SentAttachmentPreview attachment={preview} onOpenChange={(open) => { if (!open) setPreview(null); }} />
    </>
  );
}

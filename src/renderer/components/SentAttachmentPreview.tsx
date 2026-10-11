import { Button } from '@/components/base/buttons/button';
import { Modal } from '@/components/ui/modal';
import { useT } from '../i18n';
import { formatBytes } from '../session/helpers';
import type { SentAttachment } from '../session/sentAttachments';

/// Read-only preview for attachments on sent messages. Images show the stored
/// downscaled preview; text files show the captured content.
export function SentAttachmentPreview({ attachment, onOpenChange }: {
  attachment: SentAttachment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const kindLabel = !attachment ? ''
    : attachment.kind === 'image' ? t('session.kindImage') : t('session.kindFile');
  return (
    <Modal
      isOpen={attachment != null}
      onOpenChange={onOpenChange}
      aria-label={t('chat.previewAttachment')}
      title={<span className="break-all">{attachment?.name}</span>}
      description={(
        <span className="break-all text-caption-1-regular">
          {[kindLabel, attachment?.mimeType, formatBytes(attachment?.sizeBytes)].filter(Boolean).join(' · ')}
        </span>
      )}
      size="xl"
      className="max-h-[88dvh]"
      footer={<Button onClick={() => onOpenChange(false)}>{t('controls.close')}</Button>}
    >
      {attachment?.kind === 'image' ? (
        attachment.previewUrl
          ? <img src={attachment.previewUrl} alt={attachment.name} className="mx-auto max-h-[60dvh] rounded-xl object-contain" />
          : <p className="text-body-regular text-text-secondary">{t('chat.noPreviewContent')}</p>
      ) : attachment?.textContent ? (
        <pre className="whitespace-pre-wrap break-all text-body-regular text-text-primary">{attachment.textContent}</pre>
      ) : (
        <p className="text-body-regular text-text-secondary">{t('chat.noPreviewContent')}</p>
      )}
    </Modal>
  );
}

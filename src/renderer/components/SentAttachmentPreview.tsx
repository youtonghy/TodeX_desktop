import { Button, Modal } from '@heroui/react';
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
    <Modal>
      <Modal.Backdrop isOpen={attachment != null} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog
            className="w-[calc(100vw-2rem)] max-w-xl max-h-[88dvh]"
            aria-label={t('chat.previewAttachment')}
          >
            <Modal.Header>
              <Modal.Heading>{attachment?.name}</Modal.Heading>
              <p className="text-muted break-all text-xs">
                {[kindLabel, attachment?.mimeType, formatBytes(attachment?.sizeBytes)]
                  .filter(Boolean).join(' · ')}
              </p>
            </Modal.Header>
            <Modal.Body className="overflow-y-auto">
              {attachment?.kind === 'image' ? (
                attachment.previewUrl
                  ? <img src={attachment.previewUrl} alt={attachment.name} className="mx-auto max-h-[60dvh] rounded-lg object-contain" />
                  : <p className="text-muted text-sm">{t('chat.noPreviewContent')}</p>
              ) : attachment?.textContent ? (
                <pre className="whitespace-pre-wrap break-all text-sm leading-6">{attachment.textContent}</pre>
              ) : (
                <p className="text-muted text-sm">{t('chat.noPreviewContent')}</p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={() => onOpenChange(false)}>{t('controls.close')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

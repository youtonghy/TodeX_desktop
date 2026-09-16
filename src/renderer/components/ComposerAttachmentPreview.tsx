import { Button, Modal } from '@heroui/react';
import { useT } from '../i18n';
import { formatBytes, type ComposerAttachmentDraft } from '../session/helpers';

export function ComposerAttachmentPreview({ attachment, onOpenChange, onOpenSource }: {
  attachment: ComposerAttachmentDraft | null;
  onOpenChange: (open: boolean) => void;
  /** References keep a jump-to-source action inside the preview. */
  onOpenSource?: (attachment: ComposerAttachmentDraft) => void;
}) {
  const t = useT();
  const kindLabel = !attachment ? ''
    : attachment.kind === 'image' ? t('session.kindImage')
      : attachment.kind === 'reference' ? t('session.kindReference')
        : t('session.kindFile');
  const referenceLocation = attachment?.kind === 'reference' && attachment.path
    ? `${attachment.path}${attachment.lineStart ? `:${attachment.lineStart}${attachment.lineEnd && attachment.lineEnd !== attachment.lineStart ? `-${attachment.lineEnd}` : ''}` : ''}`
    : '';
  const sourceAction = attachment?.kind === 'reference'
    ? attachment.path ? t('controls.openInFiles')
      : attachment.messageId ? t('chat.jumpToMessage') : null
    : null;
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
                {[kindLabel, attachment?.mimeType, formatBytes(attachment?.sizeBytes), referenceLocation]
                  .filter(Boolean).join(' · ')}
              </p>
            </Modal.Header>
            <Modal.Body className="overflow-y-auto">
              {attachment?.kind === 'image' ? (
                attachment.dataUrl
                  ? <img src={attachment.dataUrl} alt={attachment.name} className="mx-auto max-h-[60dvh] rounded-lg object-contain" />
                  : <p className="text-muted text-sm">{t('chat.noPreviewContent')}</p>
              ) : attachment?.textContent ? (
                <pre className="whitespace-pre-wrap break-all text-sm leading-6">{attachment.textContent}</pre>
              ) : (
                <p className="text-muted text-sm">{t('chat.noPreviewContent')}</p>
              )}
            </Modal.Body>
            <Modal.Footer>
              {attachment && sourceAction ? (
                <Button variant="secondary" onPress={() => onOpenSource?.(attachment)}>{sourceAction}</Button>
              ) : null}
              <Button onPress={() => onOpenChange(false)}>{t('controls.close')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

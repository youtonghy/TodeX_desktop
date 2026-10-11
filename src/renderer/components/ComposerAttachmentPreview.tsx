import { useEffect, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { TextField } from '@/components/base/input/input';
import { TextareaBase } from '@/components/base/textarea/textarea';
import { Modal } from '@/components/ui/modal';
import { useT } from '../i18n';
import { formatBytes, type ComposerAttachmentDraft } from '../session/helpers';

export function ComposerAttachmentPreview({ attachment, onOpenChange, onOpenSource, onSaveText }: {
  attachment: ComposerAttachmentDraft | null;
  onOpenChange: (open: boolean) => void;
  /** References keep a jump-to-source action inside the preview. */
  onOpenSource?: (attachment: ComposerAttachmentDraft) => void;
  /** When provided, text attachments become editable inside the preview. */
  onSaveText?: (attachment: ComposerAttachmentDraft, text: string) => void;
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
  const editable = Boolean(onSaveText && attachment && attachment.kind !== 'image' && attachment.textContent !== undefined);
  const [draftText, setDraftText] = useState('');
  useEffect(() => {
    setDraftText(attachment?.textContent ?? '');
  }, [attachment]);
  return (
    <Modal
      isOpen={attachment != null}
      onOpenChange={onOpenChange}
      aria-label={t('chat.previewAttachment')}
      title={<span className="break-all">{attachment?.name}</span>}
      description={(
        <span className="break-all text-caption-1-regular">
          {[kindLabel, attachment?.mimeType, formatBytes(attachment?.sizeBytes), referenceLocation].filter(Boolean).join(' · ')}
        </span>
      )}
      size="xl"
      className="max-h-[88dvh]"
      footer={(
        <>
          {attachment && sourceAction ? (
            <Button variant="secondary" onClick={() => onOpenSource?.(attachment)}>{sourceAction}</Button>
          ) : null}
          <Button variant={editable ? 'secondary' : 'primary'} onClick={() => onOpenChange(false)}>{t('controls.close')}</Button>
          {editable ? (
            <Button onClick={() => { if (attachment) onSaveText?.(attachment, draftText); }}>
              {t('controls.save')}
            </Button>
          ) : null}
        </>
      )}
    >
      {attachment?.kind === 'image' ? (
        attachment.dataUrl
          ? <img src={attachment.dataUrl} alt={attachment.name} className="mx-auto max-h-[60dvh] rounded-xl object-contain" />
          : <p className="text-body-regular text-text-secondary">{t('chat.noPreviewContent')}</p>
      ) : editable ? (
        <TextField aria-label={attachment?.name} value={draftText} onChange={setDraftText}>
          <TextareaBase rows={14} className="font-mono text-caption-1-regular" />
        </TextField>
      ) : attachment?.textContent ? (
        <pre className="whitespace-pre-wrap break-all text-body-regular text-text-primary">{attachment.textContent}</pre>
      ) : (
        <p className="text-body-regular text-text-secondary">{t('chat.noPreviewContent')}</p>
      )}
    </Modal>
  );
}

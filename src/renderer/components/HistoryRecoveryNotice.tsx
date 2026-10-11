import { useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Alert } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/modal';
import { useT } from '../i18n';

type Props = {
  /** Opens settings at the history encryption section and starts setup. */
  onSetup: () => void;
  /** Hides the notice for the active backend (remembered per backend). */
  onDismiss: () => void;
  className?: string;
};

/** Non-blocking reminder that the active backend has no recovery key: if
 * every device is lost, its end-to-end encrypted history is gone. Closing it
 * asks for confirmation first, with the consequence spelled out. */
export function HistoryRecoveryNotice({ onSetup, onDismiss, className }: Props) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Alert
        status="warning"
        className={className}
        description={t('history.recoveryNotice')}
        actions={(
          <>
            <Button size="small" variant="secondary" onClick={onSetup}>{t('history.recoveryNoticeSetup')}</Button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex h-8 cursor-pointer items-center rounded-lg px-2 text-body-medium text-text-secondary outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            >
              {t('history.recoveryNoticeDismiss')}
            </button>
          </>
        )}
      />
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={t('history.recoveryNoticeDismissTitle')}
        description={t('history.recoveryNoticeDismissBody')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('history.recoveryNoticeDismissConfirm')}
        tone="danger"
        onConfirm={() => { setConfirming(false); onDismiss(); }}
      />
    </>
  );
}

import { useState } from 'react';
import { Alert, AlertDialog, Button } from '@heroui/react';
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
      <Alert status="warning" className={className}>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description>{t('history.recoveryNotice')}</Alert.Description>
        </Alert.Content>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onPress={onSetup}>{t('history.recoveryNoticeSetup')}</Button>
          <Button size="sm" variant="ghost" onPress={() => setConfirming(true)}>{t('history.recoveryNoticeDismiss')}</Button>
        </div>
      </Alert>
      <AlertDialog isOpen={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-md">
              <AlertDialog.Header>
                <AlertDialog.Heading>{t('history.recoveryNoticeDismissTitle')}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-muted text-sm">{t('history.recoveryNoticeDismissBody')}</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
                <Button variant="danger" onPress={() => { setConfirming(false); onDismiss(); }}>{t('history.recoveryNoticeDismissConfirm')}</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </>
  );
}

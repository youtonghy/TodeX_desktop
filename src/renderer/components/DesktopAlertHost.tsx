import { useEffect, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Modal } from '@/components/ui/modal';
import { dismissDesktopAlert, resolveDesktopAlert, setDesktopAlertListener, type DesktopAlertRequest } from '../lib/desktopAlert';

export function DesktopAlertHost() {
  const [request, setRequest] = useState<DesktopAlertRequest | null>(null);

  useEffect(() => {
    setDesktopAlertListener(setRequest);
    return () => setDesktopAlertListener(null);
  }, []);

  if (!request) {
    return null;
  }

  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) dismissDesktopAlert(); }}
      title={request.title}
      size="md"
      bodyClassName={request.message ? undefined : 'pb-0'}
      footer={request.buttons.map((button) => (
        <Button
          key={button.text}
          variant={button.style === 'destructive' ? 'danger' : 'secondary'}
          onClick={() => resolveDesktopAlert(button)}
        >
          {button.text}
        </Button>
      ))}
    >
      {request.message ? <p className="text-body-regular text-text-secondary">{request.message}</p> : null}
    </Modal>
  );
}

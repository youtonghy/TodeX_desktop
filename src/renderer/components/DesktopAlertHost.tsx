import { useEffect, useState } from 'react';
import { AlertDialog, Button } from '@heroui/react';
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
    <AlertDialog isOpen onOpenChange={(open) => { if (!open) dismissDesktopAlert(); }}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-md">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Heading>{request.title}</AlertDialog.Heading>
            </AlertDialog.Header>
            {request.message ? (
              <AlertDialog.Body>
                <p className="text-muted text-sm">{request.message}</p>
              </AlertDialog.Body>
            ) : null}
            <AlertDialog.Footer>
              {request.buttons.map((button) => (
                <Button
                  key={button.text}
                  slot={button.style === 'cancel' ? 'close' : undefined}
                  variant={button.style === 'destructive' ? 'danger' : button.style === 'cancel' ? 'tertiary' : 'secondary'}
                  onPress={() => resolveDesktopAlert(button)}
                >
                  {button.text}
                </Button>
              ))}
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

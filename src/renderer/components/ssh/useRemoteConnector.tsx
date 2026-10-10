import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Label, Modal, TextField, toast } from '@heroui/react';
import { isRemoteAuthFailure, isRemoteHostKeyUnverified, type OpenRemoteConnectionInput, type RemoteConnection } from '@todex/protocol/ssh';
import type { V2ApiClient } from '@todex/protocol/v2';
import { useT } from '../../i18n';

export type RemoteConnectTarget =
  | { kind: 'sftp'; host: string; label: string }
  | { kind: 'ftp'; siteId: string; label: string; askPassword: boolean };

type PasswordRequest = { label: string; resolve: (password: string | null) => void };

function connectionInput(target: RemoteConnectTarget, password?: string): OpenRemoteConnectionInput {
  const secret = password ? { password } : {};
  return target.kind === 'sftp' ? { kind: 'sftp', host: target.host, ...secret } : { kind: 'ftp', siteId: target.siteId, ...secret };
}

/**
 * Opens a remote file connection. SFTP first relies on keys/agent and the
 * shared OpenSSH master; on `REMOTE_AUTH_FAILED` (and for FTP sites with a
 * user) it asks for a password that is sent once and never kept.
 */
export function useRemoteConnector(api: () => V2ApiClient) {
  const t = useT();
  const [request, setRequest] = useState<PasswordRequest | null>(null);
  const [password, setPassword] = useState('');
  const requestRef = useRef<PasswordRequest | null>(null);
  requestRef.current = request;
  // Settle a pending prompt if the owner unmounts so callers never hang.
  useEffect(() => () => requestRef.current?.resolve(null), []);

  const askPassword = useCallback((label: string) => new Promise<string | null>((resolve) => {
    setPassword('');
    setRequest({ label, resolve });
  }), []);

  const finish = useCallback((value: string | null) => {
    requestRef.current?.resolve(value);
    setRequest(null);
    setPassword('');
  }, []);

  const connect = useCallback(async (target: RemoteConnectTarget): Promise<RemoteConnection | null> => {
    let secret: string | undefined;
    if (target.kind === 'ftp' && target.askPassword) {
      const entered = await askPassword(target.label);
      if (entered === null) return null;
      secret = entered;
    }
    for (;;) {
      try {
        return (await api().openRemoteConnection(connectionInput(target, secret))).connection;
      } catch (error) {
        if (isRemoteAuthFailure(error)) {
          if (secret !== undefined) toast.danger(t('ssh.remote.authFailed'));
          const entered = await askPassword(target.label);
          if (entered === null) return null;
          secret = entered;
          continue;
        }
        if (isRemoteHostKeyUnverified(error)) {
          toast.danger(t('ssh.remote.hostKeyUnverified'));
          return null;
        }
        toast.danger(error instanceof Error ? error.message : t('ssh.remote.openFailed'));
        return null;
      }
    }
  }, [api, askPassword, t]);

  const dialog = (
    <Modal.Backdrop isOpen={Boolean(request)} onOpenChange={(open) => { if (!open) finish(null); }}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-sm">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t('ssh.remote.passwordTitle', { label: request?.label ?? '' })}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <form id="remote-password-form" onSubmit={(event) => { event.preventDefault(); finish(password); }}>
              <TextField className="w-full" type="password" value={password} onChange={setPassword} autoFocus>
                <Label>{t('ssh.remote.password')}</Label>
                <Input className="w-full" autoComplete="off" />
              </TextField>
            </form>
            <p className="text-muted mt-2 text-xs">{t('ssh.remote.passwordHint')}</p>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
            <Button type="submit" form="remote-password-form">{t('ssh.remote.connect')}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );

  return { connect, dialog };
}

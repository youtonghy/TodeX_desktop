import { useCallback, useEffect, useRef, useState } from 'react';
import { isRemoteAuthFailure, isRemoteHostKeyUnverified, type OpenRemoteConnectionInput, type RemoteConnection } from '@todex/protocol/ssh';
import type { V2ApiClient } from '@todex/protocol/v2';
import { useT } from '../../i18n';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';

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
    <Modal
      isOpen={Boolean(request)}
      onOpenChange={(open) => { if (!open) finish(null); }}
      title={t('ssh.remote.passwordTitle', { label: request?.label ?? '' })}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={() => finish(null)}>{t('common.cancel')}</Button>
          <Button type="submit" form="remote-password-form">{t('ssh.remote.connect')}</Button>
        </>
      )}
    >
      <form id="remote-password-form" onSubmit={(event) => { event.preventDefault(); finish(password); }}>
        <Input
          label={t('ssh.remote.password')}
          hint={t('ssh.remote.passwordHint')}
          name="remote-password"
          type="password"
          autoComplete="off"
          value={password}
          onChange={setPassword}
          autoFocus
        />
      </form>
    </Modal>
  );

  return { connect, dialog };
}

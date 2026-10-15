import { useCallback, useEffect, useRef, useState } from 'react';
import { isRemoteAuthFailure, isRemoteHostKeyUnverified, type OpenRemoteConnectionInput, type RemoteConnection } from '@todex/protocol/ssh';
import type { V2ApiClient } from '@todex/protocol/v2';
import { useT } from '../../i18n';
import { canRememberSshPasswords, loadSshPassword, saveSshPassword, sshPasswordsRememberable } from '../../lib/sshPasswordStore';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';

export type RemoteConnectTarget =
  | { kind: 'sftp'; host: string; label: string }
  | { kind: 'ftp'; siteId: string; label: string; askPassword: boolean };

/** A password the user entered, and whether to save it for the SSH host. */
export type EnteredPassword = { password: string; remember: boolean };

type PasswordRequest = {
  label: string;
  /** Offer "remember" (SSH hosts on a client with a keychain). */
  rememberable: boolean;
  keychainReady: boolean;
  resolve: (entered: EnteredPassword | null) => void;
};

function connectionInput(target: RemoteConnectTarget, password?: string): OpenRemoteConnectionInput {
  const secret = password ? { password } : {};
  return target.kind === 'sftp' ? { kind: 'sftp', host: target.host, ...secret } : { kind: 'ftp', siteId: target.siteId, ...secret };
}

/**
 * Opens a remote file connection and asks for SSH/FTP passwords. SFTP first
 * uses the host's saved password, else keys/agent and the shared OpenSSH
 * master; on `REMOTE_AUTH_FAILED` (and for FTP sites with a user) it asks for
 * a password, which is sent once and saved only when the user chooses to.
 */
export function useRemoteConnector(api: () => V2ApiClient, backendId: string) {
  const t = useT();
  const [request, setRequest] = useState<PasswordRequest | null>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const requestRef = useRef<PasswordRequest | null>(null);
  requestRef.current = request;
  // Settle a pending prompt if the owner unmounts so callers never hang.
  useEffect(() => () => requestRef.current?.resolve(null), []);

  /** Asks for a password; `sshHost` offers saving it for that host. */
  const askPassword = useCallback(async (label: string, sshHost = false) => {
    const rememberable = sshHost && sshPasswordsRememberable;
    const keychainReady = rememberable && await canRememberSshPasswords();
    return new Promise<EnteredPassword | null>((resolve) => {
      setPassword('');
      setRemember(false);
      setRequest({ label, rememberable, keychainReady, resolve });
    });
  }, []);

  const finish = useCallback((value: EnteredPassword | null) => {
    requestRef.current?.resolve(value);
    setRequest(null);
    setPassword('');
  }, []);

  /** Saves a password the user asked to remember once it proved correct. */
  const rememberPassword = useCallback(async (alias: string, entered: EnteredPassword) => {
    if (!entered.remember) return;
    try {
      await saveSshPassword(backendId, alias, entered.password);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('ssh.password.saveFailed'));
    }
  }, [backendId, t]);

  const connect = useCallback(async (target: RemoteConnectTarget): Promise<RemoteConnection | null> => {
    let entered: EnteredPassword | null = null;
    let secret: string | undefined;
    if (target.kind === 'ftp' && target.askPassword) {
      entered = await askPassword(target.label);
      if (entered === null) return null;
      secret = entered.password;
    } else if (target.kind === 'sftp') {
      secret = (await loadSshPassword(backendId, target.host)) ?? undefined;
    }
    for (;;) {
      try {
        const { connection } = await api().openRemoteConnection(connectionInput(target, secret));
        if (target.kind === 'sftp' && entered) await rememberPassword(target.host, entered);
        return connection;
      } catch (error) {
        if (isRemoteAuthFailure(error)) {
          if (secret !== undefined) toast.danger(t('ssh.remote.authFailed'));
          entered = await askPassword(target.label, target.kind === 'sftp');
          if (entered === null) return null;
          secret = entered.password;
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
  }, [api, askPassword, backendId, rememberPassword, t]);

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
      <form
        id="remote-password-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => { event.preventDefault(); finish({ password, remember: remember && Boolean(request?.keychainReady) }); }}
      >
        <Input
          label={t('ssh.remote.password')}
          hint={remember ? t('ssh.password.rememberHint') : t('ssh.remote.passwordHint')}
          name="remote-password"
          type="password"
          autoComplete="off"
          value={password}
          onChange={setPassword}
          autoFocus
        />
        {request?.rememberable ? (
          <div className="flex flex-col gap-1">
            <Checkbox isSelected={remember} isDisabled={!request.keychainReady} onChange={setRemember}>{t('ssh.password.remember')}</Checkbox>
            {!request.keychainReady ? <p className="text-caption-1-regular text-text-tertiary">{t('ssh.password.keychainUnavailable')}</p> : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );

  return { connect, askPassword, rememberPassword, dialog };
}

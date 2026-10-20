import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isNotFoundError, isSshFailureKind, isSshLoginPending, type SshLoginAnswer } from '@todex/protocol/ssh';
import { useT } from '../../i18n';
import { canRememberSshPasswords, loadSshPassword, saveSshPassword, sshPasswordsRememberable } from '../../lib/sshPasswordStore';
import { ownerBackendId } from '../../session/backendRouting';
import { backendApi } from '../../session/helpers';
import type { TodeXSession } from '../../session/useTodeXSession';
import { SSH_FAILURE_LABEL_KEYS } from './sshShared';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { Modal } from '@/components/ui/modal';

/** How often expired requests are dropped from the queue. */
const EXPIRY_CHECK_MS = 5_000;

type LoginPrompt = {
  requestId: string;
  host: string;
  backendId: string;
  conversationTitle: string;
  /** Why an earlier answer did not log in. */
  error?: string;
};

/**
 * Answers the login requests agents wait on (`ssh.login.requested`) in any
 * conversation: a password saved for the host is sent right away, otherwise
 * (or when it no longer works) the user is asked. Logging in opens the
 * shared connection the agent's command then reuses; dismissing declines.
 */
export function SshLoginPrompter({ session }: { session: TodeXSession }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [queue, setQueue] = useState<LoginPrompt[]>([]);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [keychainReady, setKeychainReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const handledRef = useRef(new Set<string>());
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), EXPIRY_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const pending = useMemo(() => {
    const requests: { requestId: string; host: string; conversationId: string }[] = [];
    for (const [conversationId, runtime] of Object.entries(session.conversationRuntimeById)) {
      for (const run of runtime.sshExecs) {
        if (run.host && run.login && isSshLoginPending(run.login, now)) requests.push({ requestId: run.login.requestId, host: run.host, conversationId });
      }
    }
    return requests;
  }, [now, session.conversationRuntimeById]);

  // Answered elsewhere, timed out or cancelled: close its prompt.
  useEffect(() => {
    const open = new Set(pending.map(request => request.requestId));
    setQueue(current => (current.every(prompt => open.has(prompt.requestId)) ? current : current.filter(prompt => open.has(prompt.requestId))));
  }, [pending]);

  const answer = useCallback((prompt: LoginPrompt, input: { password?: string; saved?: boolean }): Promise<SshLoginAnswer> => (
    backendApi(sessionRef.current.settingsForBackend(prompt.backendId))
      .answerSshLogin(prompt.host, { requestId: prompt.requestId, ...input })
  ), []);

  const failureText = useCallback((result: SshLoginAnswer) => {
    const failure = result.status === 'failed' && isSshFailureKind(result.failure) ? result.failure : 'other';
    return t(SSH_FAILURE_LABEL_KEYS[failure]);
  }, [t]);

  useEffect(() => {
    for (const request of pending) {
      if (handledRef.current.has(request.requestId)) continue;
      handledRef.current.add(request.requestId);
      const current = sessionRef.current;
      const conversation = current.conversations.find(item => item.id === request.conversationId);
      const workspace = current.workspaces.find(item => item.id === conversation?.workspaceId);
      const prompt: LoginPrompt = {
        requestId: request.requestId,
        host: request.host,
        backendId: ownerBackendId(conversation, workspace, current.noWorkspaceBackendId),
        conversationTitle: conversation?.title?.trim() || workspace?.name?.trim() || 'TodeX',
      };
      void (async () => {
        const saved = await loadSshPassword(prompt.backendId, prompt.host);
        if (saved) {
          try {
            const result = await answer(prompt, { password: saved, saved: true });
            if (result.status !== 'failed') return;
            prompt.error = t('sshLogin.savedFailed', { reason: failureText(result) });
          } catch (error) {
            if (isNotFoundError(error)) return;
            prompt.error = error instanceof Error ? error.message : String(error);
          }
        }
        setQueue(current => [...current, prompt]);
      })();
    }
  }, [answer, failureText, pending, t]);

  const prompt = queue[0] ?? null;
  const promptId = prompt?.requestId;
  useEffect(() => {
    setPassword('');
    setRemember(false);
    if (!promptId || !sshPasswordsRememberable) return;
    let cancelled = false;
    void canRememberSshPasswords().then((ready) => { if (!cancelled) setKeychainReady(ready); });
    return () => { cancelled = true; };
  }, [promptId]);

  const close = useCallback((requestId: string) => {
    setQueue(current => current.filter(item => item.requestId !== requestId));
  }, []);

  const setError = useCallback((requestId: string, error: string) => {
    setQueue(current => current.map(item => (item.requestId === requestId ? { ...item, error } : item)));
  }, []);

  const decline = useCallback(() => {
    if (!prompt) return;
    close(prompt.requestId);
    void answer(prompt, {}).catch(() => undefined);
  }, [answer, close, prompt]);

  const submit = useCallback(async () => {
    if (!prompt || !password || busy) return;
    setBusy(true);
    try {
      const result = await answer(prompt, { password });
      if (result.status === 'failed') {
        setError(prompt.requestId, t('sshLogin.failed', { reason: failureText(result) }));
        return;
      }
      close(prompt.requestId);
      if (result.status === 'connected' && remember && keychainReady) {
        await saveSshPassword(prompt.backendId, prompt.host, password).catch(() => setError(prompt.requestId, t('ssh.password.saveFailed')));
      }
    } catch (error) {
      if (isNotFoundError(error)) close(prompt.requestId);
      else setError(prompt.requestId, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [answer, busy, close, failureText, keychainReady, password, prompt, remember, setError, t]);

  return (
    <Modal
      isOpen={Boolean(prompt)}
      onOpenChange={(open) => { if (!open) decline(); }}
      title={t('ssh.remote.passwordTitle', { label: prompt?.host ?? '' })}
      description={t('sshLogin.description', { conversation: prompt?.conversationTitle ?? '' })}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={decline}>{t('common.cancel')}</Button>
          <Button type="submit" form="ssh-login-form" disabled={!password || busy}>{t('ssh.remote.connect')}</Button>
        </>
      )}
    >
      <form
        id="ssh-login-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        {prompt?.error ? <p role="alert" className="text-body-2-regular text-text-error-primary">{prompt.error}</p> : null}
        <Input
          label={t('ssh.remote.password')}
          hint={remember ? t('ssh.password.rememberHint') : t('ssh.remote.passwordHint')}
          name="ssh-login-password"
          type="password"
          autoComplete="off"
          value={password}
          onChange={setPassword}
          autoFocus
        />
        {sshPasswordsRememberable ? (
          <div className="flex flex-col gap-1">
            <Checkbox isSelected={remember} isDisabled={!keychainReady} onChange={setRemember}>{t('ssh.password.remember')}</Checkbox>
            {!keychainReady ? <p className="text-caption-1-regular text-text-tertiary">{t('ssh.password.keychainUnavailable')}</p> : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

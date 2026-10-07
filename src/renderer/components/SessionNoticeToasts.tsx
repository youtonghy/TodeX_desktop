import { useEffect, useState } from 'react';
import { connectionFailureLabel, type ConnectionHealth } from '../session/helpers';
import { useT } from '../i18n';
import { useNoticeToast } from './NoticeToast';

type Props = {
  lastError: string;
  health: ConnectionHealth;
  scope: string;
  /** Opens device pairing again; offered when the transport refuses the profile. */
  onRepair?: () => void;
};

export function SessionNoticeToasts({ lastError, health, scope, onRepair }: Props) {
  const t = useT();
  const [failure, setFailure] = useState({ scope: '', message: '', error: '' });
  const message = connectionFailureLabel(health.code) || health.error;
  useEffect(() => {
    // Polling temporarily clears the error while checking. Only a settled health
    // result resets the notice, so an offline backend does not notify every poll.
    if (health.status === 'checking') return;
    setFailure(previous => previous.scope === scope && previous.message === message && previous.error === health.error
      ? previous : { scope, message, error: health.error });
  }, [health.status, health.error, message, scope]);

  // A missing, unverified or outdated transport pin is fixed only by pairing
  // again, so those notices carry the re-pair action.
  const repair = health.code === 'encryption_required' && onRepair
    ? { actionLabel: t('pair.repair'), onAction: onRepair, timeout: 12000 }
    : {};
  useNoticeToast(lastError, { variant: 'danger', scope, ...repair });
  useNoticeToast(failure.scope === scope && (!lastError || (failure.message !== lastError && failure.error !== lastError))
    ? failure.message : null, { variant: 'danger', scope, ...repair });
  return null;
}

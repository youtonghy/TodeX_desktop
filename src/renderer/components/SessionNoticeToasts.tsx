import { useEffect, useState } from 'react';
import { connectionFailureLabel } from '@todex/protocol/connectionError';
import type { ConnectionHealth } from '../session/helpers';
import { useNoticeToast } from './NoticeToast';

type Props = { lastError: string; health: ConnectionHealth; scope: string };

export function SessionNoticeToasts({ lastError, health, scope }: Props) {
  const [failure, setFailure] = useState({ scope: '', message: '', error: '' });
  const message = connectionFailureLabel(health.code) || health.error;
  useEffect(() => {
    // Polling temporarily clears the error while checking. Only a settled health
    // result resets the notice, so an offline backend does not notify every poll.
    if (health.status === 'checking') return;
    setFailure(previous => previous.scope === scope && previous.message === message && previous.error === health.error
      ? previous : { scope, message, error: health.error });
  }, [health.status, health.error, message, scope]);

  useNoticeToast(lastError, { variant: 'danger', scope });
  useNoticeToast(failure.scope === scope && (!lastError || (failure.message !== lastError && failure.error !== lastError))
    ? failure.message : null, { variant: 'danger', scope });
  return null;
}

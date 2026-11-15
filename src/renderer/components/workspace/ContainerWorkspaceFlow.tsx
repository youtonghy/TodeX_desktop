import { useEffect } from 'react';
import { toast } from '@/components/ui/toast-store';
import { useT } from '../../i18n';
import { backgroundSetups } from './useContainerWorkspaceFlow';

/** Toasts the outcome of setup runs sent to the background (mounted once, in App). */
export function ContainerSetupNotices() {
  const t = useT();
  useEffect(() => window.todexDesktop.container.onSetupDone((done) => {
    const name = backgroundSetups.get(done.jobId);
    if (name === undefined) return;
    backgroundSetups.delete(done.jobId);
    if (done.ok) toast.success(t('container.setup.doneNotice', { name }));
    else if (!done.cancelled) toast.danger(t('container.setup.failedNotice', { name, code: done.exitCode ?? '-' }), { description: done.error ?? undefined });
  }), [t]);
  return null;
}

import { useEffect, useState } from 'react';
import { RiRefreshLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { useT } from '../../i18n';
import { CodeBlock } from '../ui/code-block';
import { Modal } from '../ui/modal';
import { Spinner } from '../ui/spinner';

/** The last 500 lines of a TodeX container's log (`docker logs`). */
export function ContainerLogsDialog({ name, onClose }: { name: string | null; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setText(null);
    setError('');
    window.todexDesktop.container.logs(name).then(
      (logs) => !cancelled && setText(logs),
      (cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => { cancelled = true; };
  }, [name, nonce]);

  return (
    <Modal
      isOpen={name !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('container.logsTitle', { name: name ?? '' })}
      size="3xl"
      bodyClassName="flex flex-col gap-3"
      footer={<Button variant="secondary" leadingIcon={RiRefreshLine} onClick={() => setNonce((value) => value + 1)}>{t('container.logsRefresh')}</Button>}
    >
      {error ? <p role="alert" className="text-body-2-regular text-text-error-primary">{error}</p> : null}
      {text === null && !error ? <div className="flex justify-center py-6"><Spinner aria-label={t('container.logs')} /></div> : null}
      {text !== null ? <CodeBlock code={text || t('localBackend.logEmpty')} language="plaintext" className="max-h-[60vh]" /> : null}
    </Modal>
  );
}

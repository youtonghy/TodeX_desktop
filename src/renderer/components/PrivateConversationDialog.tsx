import { useState } from 'react';
import { RiSpyLine } from '@remixicon/react';
import { providerDisplayName, type ProviderDescriptor, type ProviderKind } from '@todex/protocol/v2';
import { Button } from '@/components/base/buttons/button';
import { RadioGroup } from '@/components/base/radio/radio';
import { RadioCard } from '@/components/base/radio/radio-card';
import { Alert } from '@/components/ui/alert';
import { Modal } from '@/components/ui/modal';
import { ProviderIcon } from './ProviderIcon';
import { useT } from '../i18n';

export type PrivateConversationAgents = {
  providers: Array<ProviderDescriptor & { privateMode: 'native' | 'scrubbed' | null }>;
  defaultProvider?: ProviderKind;
};

/** Starts a private (RAM-only) conversation: picks the agent (only those
 * that can keep a conversation private are selectable) and states what
 * private means. `onConfirm` resolves whether the conversation was created. */
export function PrivateConversationDialog({ isOpen, agents, onConfirm, onClose }: {
  isOpen: boolean;
  agents?: PrivateConversationAgents;
  onConfirm: (options: { provider?: ProviderKind }) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const [provider, setProvider] = useState<ProviderKind | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  // A fresh open starts from the default agent.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setProvider(agents?.defaultProvider);
      setBusy(false);
    }
  }
  const choices = agents?.providers ?? [];
  const eligible = choices.filter((item) => item.privateMode);
  const picked = eligible.some((item) => item.id === provider) ? provider : agents?.defaultProvider ?? eligible[0]?.id;

  const submit = async () => {
    if (!picked || busy) return;
    setBusy(true);
    const created = await onConfirm({ provider: picked });
    setBusy(false);
    if (created) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('private.createTitle')}
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => { void submit(); }} disabled={!picked || busy}>{t('private.confirm')}</Button>
        </>
      )}
    >
      <Alert status="neutral" icon={RiSpyLine} description={t('private.notice')} />
      {eligible.length === 0 ? (
        <Alert status="warning" description={t('private.backendUnsupportedHint')} />
      ) : (
        <RadioGroup
          aria-label={t('private.agent')}
          value={picked ?? null}
          onChange={(value) => setProvider(value as ProviderKind)}
        >
          {choices.map((item) => (
            <RadioCard
              key={item.id}
              value={item.id}
              isDisabled={!item.privateMode}
              title={(
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderIcon className="size-4 shrink-0" provider={item.id} />
                  <span className="truncate">{providerDisplayName(item.id, item.displayName)}</span>
                </span>
              )}
              description={item.privateMode === 'native' ? t('private.modeNative')
                : item.privateMode === 'scrubbed' ? t('private.modeScrubbed') : t('private.agentUnsupported')}
            />
          ))}
        </RadioGroup>
      )}
    </Modal>
  );
}

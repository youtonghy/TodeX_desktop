import { useId, useState } from 'react';
import {
  SSH_FORWARD_DEFAULT_BIND_ADDRESS, SSH_FORWARD_LABEL_MAX, SSH_LOOPBACK_BIND_ADDRESSES, SSH_TARGET_HOST_MAX, isLoopbackBindAddress,
  type SshForward, type SshForwardInput, type SshForwardKind, type SshHost,
} from '@todex/protocol/ssh';
import { Field } from '../Field';
import { useT, type MessageKey } from '../../i18n';
import { errorMessage, parsePort, type SshApi } from './sshShared';
import { Button } from '@/components/base/buttons/button';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { Modal } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

export const SSH_FORWARD_KIND_LABEL_KEYS: Record<SshForwardKind, MessageKey> = {
  local: 'ssh.forwards.kindLocal',
  remote: 'ssh.forwards.kindRemote',
  dynamic: 'ssh.forwards.kindDynamic',
};

const KIND_HINT_KEYS: Record<SshForwardKind, MessageKey> = {
  local: 'ssh.forwards.kindLocalHint',
  remote: 'ssh.forwards.kindRemoteHint',
  dynamic: 'ssh.forwards.kindDynamicHint',
};

const REMOTE_BIND_PATTERN = /^[A-Za-z0-9.:_-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Create or edit a manual port forward (`ssh -L` / `-R` / `-D`). */
export function SshForwardDialog({ api, hosts, forward, initialAlias, onClose, onSaved }: {
  api: SshApi;
  hosts: SshHost[];
  /** Editing when set. */
  forward?: SshForward;
  /** Host preselected for a new forward. */
  initialAlias?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const kindLabelId = useId();
  const [alias, setAlias] = useState(forward?.alias ?? initialAlias ?? hosts[0]?.alias ?? '');
  const [kind, setKind] = useState<SshForwardKind>(forward?.kind ?? 'local');
  const [loopbackBind, setLoopbackBind] = useState(
    forward && forward.kind !== 'remote' && isLoopbackBindAddress(forward.bindAddress) ? forward.bindAddress! : SSH_FORWARD_DEFAULT_BIND_ADDRESS,
  );
  const [remoteBind, setRemoteBind] = useState(forward?.kind === 'remote' ? forward.bindAddress ?? '' : '');
  const [bindPort, setBindPort] = useState(forward ? String(forward.bindPort) : '');
  const [targetHost, setTargetHost] = useState(forward?.targetHost ?? (forward ? '' : 'localhost'));
  const [targetPort, setTargetPort] = useState(forward?.targetPort ? String(forward.targetPort) : '');
  const [label, setLabel] = useState(forward?.label ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!alias) return toast.danger(t('ssh.forwards.hostRequired'));
    const port = parsePort(bindPort);
    if (!port) return toast.danger(t('ssh.portInvalid'));
    let bindAddress: string | undefined = loopbackBind;
    if (kind === 'remote') {
      bindAddress = remoteBind.trim() || undefined;
      if (bindAddress && !REMOTE_BIND_PATTERN.test(bindAddress)) return toast.danger(t('ssh.forwards.bindAddressInvalid'));
    }
    let target: Pick<SshForwardInput, 'targetHost' | 'targetPort'> = {};
    if (kind !== 'dynamic') {
      const host = targetHost.trim();
      if (!host || /\s/.test(host) || host.startsWith('-') || host.length > SSH_TARGET_HOST_MAX) return toast.danger(t('ssh.forwards.targetHostInvalid'));
      const parsedTarget = parsePort(targetPort);
      if (!parsedTarget) return toast.danger(t('ssh.portInvalid'));
      target = { targetHost: host, targetPort: parsedTarget };
    }
    const trimmedLabel = label.trim();
    if (trimmedLabel.length > SSH_FORWARD_LABEL_MAX || CONTROL_CHARS.test(trimmedLabel)) {
      return toast.danger(t('ssh.forwards.labelInvalid', { max: SSH_FORWARD_LABEL_MAX }));
    }
    const input: SshForwardInput = {
      alias,
      kind,
      ...(bindAddress ? { bindAddress } : {}),
      bindPort: port,
      ...target,
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
    };
    setSaving(true);
    try {
      if (forward) await api().updateSshForward(forward.id, input);
      else await api().createSshForward(input);
      toast.success(t(forward ? 'ssh.forwards.updated' : 'ssh.forwards.created'));
      onSaved();
      onClose();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.forwards.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={forward ? t('ssh.forwards.editTitle') : t('ssh.forwards.addTitle')}
      size="lg"
      className="max-h-[90vh]"
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={saving} leadingIcon={saving ? SpinnerIcon : undefined} aria-busy={saving || undefined} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      )}
    >
      <Select
        label={t('ssh.forwards.host')}
        className="w-full"
        popoverClassName="w-(--trigger-width)"
        placeholder={t('ssh.forwards.hostPlaceholder')}
        selectedKey={alias || null}
        onSelectionChange={(key) => { if (key !== null) setAlias(String(key)); }}
      >
        {hosts.map((host) => <SelectItem key={host.alias} id={host.alias} textValue={host.alias}>{host.alias}</SelectItem>)}
      </Select>
      <div className="flex flex-col gap-1.5">
        <span id={kindLabelId} className="text-body-medium text-text-primary">{t('ssh.forwards.kind')}</span>
        <SegmentedControl
          aria-labelledby={kindLabelId}
          className="self-start"
          selectedKeys={[kind]}
          onSelectionChange={(keys) => {
            const [next] = [...keys] as SshForwardKind[];
            if (next) setKind(next);
          }}
        >
          <SegmentedControlItem id="local">{t('ssh.forwards.kindLocal')}</SegmentedControlItem>
          <SegmentedControlItem id="remote">{t('ssh.forwards.kindRemote')}</SegmentedControlItem>
          <SegmentedControlItem id="dynamic">{t('ssh.forwards.kindDynamic')}</SegmentedControlItem>
        </SegmentedControl>
        <p className="text-caption-1-regular text-text-tertiary">{t(KIND_HINT_KEYS[kind])}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        {kind === 'remote' ? (
          <Field label={t('ssh.forwards.bindAddress')} value={remoteBind} onChange={setRemoteBind} description={t('ssh.forwards.remoteBindHint')} />
        ) : (
          <Select
            label={t('ssh.forwards.bindAddress')}
            className="w-full"
            popoverClassName="w-(--trigger-width)"
            selectedKey={loopbackBind}
            onSelectionChange={(key) => { if (key !== null) setLoopbackBind(String(key)); }}
          >
            {SSH_LOOPBACK_BIND_ADDRESSES.map((address) => <SelectItem key={address} id={address} textValue={address}>{address}</SelectItem>)}
          </Select>
        )}
        <Field label={t('ssh.forwards.bindPort')} value={bindPort} onChange={setBindPort} />
      </div>
      {kind !== 'dynamic' ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field
            label={t('ssh.forwards.targetHost')}
            value={targetHost}
            onChange={setTargetHost}
            description={t(kind === 'local' ? 'ssh.forwards.targetLocalHint' : 'ssh.forwards.targetRemoteHint')}
          />
          <Field label={t('ssh.forwards.targetPort')} value={targetPort} onChange={setTargetPort} />
        </div>
      ) : null}
      <Field label={t('ssh.forwards.label')} value={label} onChange={setLabel} description={t('ssh.forwards.labelHint')} />
    </Modal>
  );
}

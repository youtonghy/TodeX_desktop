import { useState } from 'react';
import { RiComputerLine, RiDeleteBinLine, RiGroupLine, RiServerLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { RadioGroup } from '@/components/base/radio/radio';
import { RadioCard } from '@/components/base/radio/radio-card';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Textarea } from '@/components/base/textarea/textarea';
import { isMeshJoinCode } from '@todex/protocol/mesh';
import { connectionStateLabel } from '../../session/helpers';
import type { MeshGroupView, MeshJoinView, MeshMemberView } from '../../session/useMeshGroups';
import type { TodeXSession } from '../../session/useTodeXSession';
import { useT } from '../../i18n';
import { Alert } from '../ui/alert';
import { CodeBlock } from '../ui/code-block';
import { EmptyState } from '../ui/empty-state';
import { IconAction } from '../ui/icon-action';
import { ConfirmDialog, Modal } from '../ui/modal';
import { Spinner } from '../ui/spinner';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from './SettingsRows';

// Settings → Backend groups (TodeX_backend docs/mesh-v1.md): create or join a
// group, approve devices that ask to join (approval also covers history),
// invite devices, add backends and remove members. Point-to-point backends
// stay under Backend connections.

const STATE_COLORS = { open: 'lime', connecting: 'yellow', error: 'rose', closed: 'neutral', idle: 'neutral' } as const;

type Dialog =
  | { kind: 'create' }
  | { kind: 'recovery'; words: string[] }
  | { kind: 'join' }
  | { kind: 'invite'; group: MeshGroupView }
  | { kind: 'addBackend'; group: MeshGroupView }
  | { kind: 'approve'; request: MeshJoinView }
  | { kind: 'remove'; group: MeshGroupView; member: MeshMemberView }
  | { kind: 'leave'; group: MeshGroupView };

export function MeshGroupSettings({ session }: { session: TodeXSession }) {
  const t = useT();
  const mesh = session.meshGroups;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => { setDialog(null); setError(''); setBusy(false); };
  /** Runs a dialog's action: errors stay in the dialog. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('mesh.actionFailed'));
      setBusy(false);
    }
  };

  const actions = (
    <>
      <Button size="small" variant="secondary" onClick={() => setDialog({ kind: 'join' })}>{t('mesh.join')}</Button>
      <Button size="small" variant="secondary" onClick={() => setDialog({ kind: 'create' })}>{t('mesh.create')}</Button>
    </>
  );

  return (
    <>
      {mesh.joinRequests.length ? (
        <SettingsGroup label={t('mesh.pendingTitle')} description={t('mesh.pendingHint')}>
          <SettingsCard>
            {mesh.joinRequests.map((request) => (
              <SettingsRow
                key={request.requestId}
                icon={RiComputerLine}
                label={request.deviceName}
                description={t('mesh.pendingDetail', { group: request.groupName, peer: request.peerAddress || '—' })}
              >
                <span className="font-mono text-body-2-medium text-text-primary">{request.verificationCode}</span>
                <Button size="small" variant="secondary" onClick={() => void mesh.rejectJoin(request).catch(() => undefined)}>{t('mesh.reject')}</Button>
                <Button size="small" onClick={() => setDialog({ kind: 'approve', request })}>{t('mesh.approve')}</Button>
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsGroup>
      ) : null}

      {mesh.joinProgress.status !== 'idle' ? <JoinProgress session={session} /> : null}

      {mesh.groups.length === 0 ? (
        <SettingsCard>
          <EmptyState icon={RiGroupLine} title={t('mesh.emptyTitle')} description={t('mesh.emptyHint')}>
            {actions}
          </EmptyState>
        </SettingsCard>
      ) : mesh.groups.map((group, index) => (
        <SettingsGroup
          key={group.groupId}
          label={group.name}
          description={group.pending ? t('mesh.pendingRoster') : t('mesh.groupHint', { version: group.version })}
          action={(
            <>
              {index === 0 ? actions : null}
              <Button size="small" variant="secondary" disabled={group.pending || !group.invite} onClick={() => setDialog({ kind: 'invite', group })}>{t('mesh.invite')}</Button>
              <Button size="small" variant="secondary" disabled={group.pending} onClick={() => setDialog({ kind: 'addBackend', group })}>{t('mesh.addBackend')}</Button>
            </>
          )}
        >
          <SettingsCard>
            {group.members.map((member) => (
              <SettingsRow
                key={member.id}
                icon={member.kind === 'node' ? RiServerLine : RiComputerLine}
                label={(
                  <span className="flex items-center gap-2">
                    <span className="truncate">{member.name}</span>
                    {member.self ? <Chip variant="caption" color="neutral">{t('mesh.thisDevice')}</Chip> : null}
                  </span>
                )}
                description={member.kind === 'node'
                  ? (member.info?.urls[0] ?? member.id)
                  : member.id}
              >
                {member.kind === 'node'
                  ? <Chip variant="caption" color={STATE_COLORS[member.state ?? 'idle']}>{member.profileId ? connectionStateLabel(member.state ?? 'idle') : t('mesh.nodeUnknown')}</Chip>
                  : null}
                {member.self ? null : (
                  <IconAction icon={RiDeleteBinLine} size="sm" aria-label={t('mesh.removeMember', { name: member.name })} onClick={() => setDialog({ kind: 'remove', group, member })} />
                )}
              </SettingsRow>
            ))}
            {group.pending ? <SettingsNote>{t('mesh.pendingRoster')}</SettingsNote> : null}
            <SettingsRow label={t('mesh.leave')} description={t('mesh.leaveHint')}>
              <Button size="small" variant="secondary" onClick={() => setDialog({ kind: 'leave', group })}>{t('mesh.leave')}</Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsGroup>
      ))}

      <CreateDialog
        isOpen={dialog?.kind === 'create'}
        busy={busy}
        error={error}
        onClose={close}
        onCreate={(name) => {
          setBusy(true);
          setError('');
          // The recovery words replace the dialog: they are shown once.
          mesh.createGroup(name).then(({ recoveryWords }) => {
            setBusy(false);
            setDialog({ kind: 'recovery', words: recoveryWords });
          }, (failure: unknown) => {
            setError(failure instanceof Error ? failure.message : t('mesh.actionFailed'));
            setBusy(false);
          });
        }}
      />
      <RecoveryDialog words={dialog?.kind === 'recovery' ? dialog.words : null} onClose={close} />
      <JoinDialog
        isOpen={dialog?.kind === 'join'}
        onClose={close}
        onJoin={(invite) => {
          close();
          void mesh.joinGroup(invite);
        }}
      />
      <InviteDialog group={dialog?.kind === 'invite' ? dialog.group : null} onClose={close} />
      {dialog?.kind === 'addBackend' ? (
        <AddBackendDialog
          session={session}
          group={dialog.group}
          busy={busy}
          error={error}
          onClose={close}
          onAddPaired={(profileId) => void run(() => mesh.addPairedBackend(dialog.group.groupId, profileId))}
          onAddWithCode={(url, code) => void run(() => mesh.addBackendWithCode(dialog.group.groupId, url, code))}
        />
      ) : null}
      <ConfirmDialog
        isOpen={dialog?.kind === 'approve'}
        onOpenChange={(open) => { if (!open) close(); }}
        title={t('mesh.approveTitle', { name: dialog?.kind === 'approve' ? dialog.request.deviceName : '' })}
        description={t('mesh.approveHint')}
        confirmLabel={t('mesh.approve')}
        cancelLabel={t('common.cancel')}
        isPending={busy}
        onConfirm={() => { if (dialog?.kind === 'approve') void run(() => mesh.approveJoin(dialog.request)); }}
      >
        {dialog?.kind === 'approve' ? (
          <div className="flex flex-col gap-2">
            <span className="font-mono text-title-3-semibold text-text-primary">{dialog.request.verificationCode}</span>
            <span className="text-body-2-regular text-text-secondary">{dialog.request.deviceId}</span>
            {error ? <Alert status="danger" title={error} /> : null}
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={dialog?.kind === 'remove'}
        onOpenChange={(open) => { if (!open) close(); }}
        title={t('mesh.removeTitle', { name: dialog?.kind === 'remove' ? dialog.member.name : '' })}
        description={dialog?.kind === 'remove' && dialog.member.kind === 'node' ? t('mesh.removeNodeHint') : t('mesh.removeDeviceHint')}
        confirmLabel={t('mesh.remove')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={busy}
        onConfirm={() => { if (dialog?.kind === 'remove') void run(() => mesh.removeMember(dialog.group.groupId, dialog.member.id)); }}
      >
        {error ? <Alert status="danger" title={error} /> : null}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={dialog?.kind === 'leave'}
        onOpenChange={(open) => { if (!open) close(); }}
        title={t('mesh.leaveTitle', { name: dialog?.kind === 'leave' ? dialog.group.name : '' })}
        description={dialog?.kind === 'leave' && dialog.group.members.filter((member) => member.kind === 'device').length <= 1 ? t('mesh.dissolveHint') : t('mesh.leaveConfirmHint')}
        confirmLabel={t('mesh.leave')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={busy}
        onConfirm={() => { if (dialog?.kind === 'leave') void run(() => mesh.leaveGroup(dialog.group.groupId)); }}
      >
        {error ? <Alert status="danger" title={error} /> : null}
      </ConfirmDialog>
    </>
  );
}

function JoinProgress({ session }: { session: TodeXSession }) {
  const t = useT();
  const progress = session.meshGroups.joinProgress;
  if (progress.status === 'error') {
    return (
      <Alert
        status="danger"
        title={t('mesh.joinFailed')}
        description={progress.error}
        actions={<Button size="small" variant="secondary" onClick={session.meshGroups.cancelJoin}>{t('common.close')}</Button>}
      />
    );
  }
  return (
    <SettingsGroup label={t('mesh.joiningTitle')}>
      <SettingsCard>
        {progress.status === 'waiting' ? (
          <SettingsRow label={t('mesh.waitingApproval', { name: progress.nodeName })} description={t('mesh.waitingApprovalHint')}>
            <span className="font-mono text-title-3-semibold text-text-primary">{progress.verificationCode}</span>
            <Button size="small" variant="secondary" onClick={session.meshGroups.cancelJoin}>{t('common.cancel')}</Button>
          </SettingsRow>
        ) : (
          <SettingsRow label={t('mesh.connecting')}>
            <Spinner />
            <Button size="small" variant="secondary" onClick={session.meshGroups.cancelJoin}>{t('common.cancel')}</Button>
          </SettingsRow>
        )}
      </SettingsCard>
    </SettingsGroup>
  );
}

function CreateDialog({ isOpen, busy, error, onClose, onCreate }: {
  isOpen: boolean; busy: boolean; error: string; onClose: () => void; onCreate: (name: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const valid = name.trim().length > 0 && name.trim().length <= 80;
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('mesh.createTitle')}
      description={t('mesh.createHint')}
      footer={(
        <>
          <Button size="small" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="small" disabled={!valid || busy} onClick={() => onCreate(name)}>{t('mesh.create')}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <Input aria-label={t('mesh.groupName')} name="group-name" size="small" placeholder={t('mesh.groupNamePlaceholder')} value={name} onChange={setName} />
        {error ? <Alert status="danger" title={error} /> : null}
      </div>
    </Modal>
  );
}

function RecoveryDialog({ words, onClose }: { words: string[] | null; onClose: () => void }) {
  const t = useT();
  return (
    <Modal
      isOpen={Boolean(words)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('mesh.recoveryTitle')}
      description={t('mesh.recoveryHint')}
      isDismissable={false}
      footer={<Button size="small" onClick={onClose}>{t('mesh.recoverySaved')}</Button>}
    >
      <ol aria-label={t('history.recoveryWords')} className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-caption-1-regular text-text-primary sm:grid-cols-4">
        {(words ?? []).map((word, index) => <li key={index}><span className="text-text-tertiary">{index + 1}.</span> {word}</li>)}
      </ol>
    </Modal>
  );
}

function JoinDialog({ isOpen, onClose, onJoin }: { isOpen: boolean; onClose: () => void; onJoin: (invite: string) => void }) {
  const t = useT();
  const [invite, setInvite] = useState('');
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('mesh.joinTitle')}
      description={t('mesh.joinHint')}
      footer={(
        <>
          <Button size="small" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="small" disabled={!invite.trim()} onClick={() => { onJoin(invite); setInvite(''); }}>{t('mesh.join')}</Button>
        </>
      )}
    >
      <Textarea aria-label={t('mesh.inviteLabel')} rows={5} placeholder={t('mesh.invitePlaceholder')} value={invite} onChange={setInvite} />
    </Modal>
  );
}

function InviteDialog({ group, onClose }: { group: MeshGroupView | null; onClose: () => void }) {
  const t = useT();
  return (
    <Modal
      isOpen={Boolean(group)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('mesh.inviteTitle', { name: group?.name ?? '' })}
      description={t('mesh.inviteHint')}
      footer={<Button size="small" onClick={onClose}>{t('common.close')}</Button>}
    >
      {group ? <CodeBlock code={group.invite} title={t('mesh.inviteLabel')} codeClassName="whitespace-pre-wrap break-all" /> : null}
    </Modal>
  );
}

function AddBackendDialog({ session, group, busy, error, onClose, onAddPaired, onAddWithCode }: {
  session: TodeXSession;
  group: MeshGroupView;
  busy: boolean;
  error: string;
  onClose: () => void;
  onAddPaired: (profileId: string) => void;
  onAddWithCode: (url: string, code: string) => void;
}) {
  const t = useT();
  // Paired point-to-point backends that are connected and support groups.
  const paired = session.backendConnections.filter((profile) => !profile.mesh && !profile.disabled && profile.transportVerified
    && session.backendLinkStatus[profile.id]?.state === 'open' && session.backendLinkStatus[profile.id]?.serverVersion?.mesh === 1);
  const [mode, setMode] = useState<'paired' | 'code'>(paired.length ? 'paired' : 'code');
  const [selected, setSelected] = useState(paired[0]?.id ?? '');
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const canAdd = mode === 'paired' ? Boolean(selected) : /^https?:\/\//i.test(url.trim()) && isMeshJoinCode(code);
  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('mesh.addBackendTitle', { name: group.name })}
      description={mode === 'paired' ? t('mesh.addPairedHint') : t('mesh.addCodeHint')}
      footer={(
        <>
          <Button size="small" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            size="small"
            disabled={!canAdd || busy}
            onClick={() => (mode === 'paired' ? onAddPaired(selected) : onAddWithCode(url.trim(), code))}
          >
            {busy ? t('mesh.adding') : t('mesh.addBackend')}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl aria-label={t('mesh.addBackend')} selectedKeys={[mode]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next === 'paired' || next === 'code') setMode(next); }}>
          <SegmentedControlItem id="paired">{t('mesh.addPaired')}</SegmentedControlItem>
          <SegmentedControlItem id="code">{t('mesh.addWithCode')}</SegmentedControlItem>
        </SegmentedControl>
        {mode === 'paired' ? (
          paired.length ? (
            <RadioGroup aria-label={t('mesh.addPaired')} value={selected || null} onChange={setSelected}>
              {paired.map((profile) => (
                <RadioCard key={profile.id} value={profile.id} title={profile.name} description={profile.serverUrl} />
              ))}
            </RadioGroup>
          ) : <p className="text-body-regular text-text-secondary">{t('mesh.noPairedBackends')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Input aria-label={t('settings.serverUrl')} name="mesh-url" size="small" placeholder="http://192.168.1.20:7345" value={url} onChange={setUrl} />
            <Input aria-label={t('mesh.joinCode')} name="mesh-code" size="small" placeholder="XXXX-XXXX-XXXX-XXXX" value={code} onChange={setCode} />
            <p className="text-body-2-regular text-text-secondary">{t('mesh.joinCodeHint')}</p>
          </div>
        )}
        {busy ? <Spinner /> : null}
        {error ? <Alert status="danger" title={error} /> : null}
      </div>
    </Modal>
  );
}

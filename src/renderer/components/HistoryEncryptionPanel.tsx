import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertDialog, Button, Checkbox, Chip, Label, ProgressBar, Spinner, TextArea, TextField, toast } from '@heroui/react';
import { encodeQrCode } from '@todex/protocol/qrCode';
import type { HistoryRecipient, HistoryRevokedDevice, HistoryRewrapProgress } from '@todex/protocol/historyEncryption';
import type { HistoryEncryptionSession, RecoveryKeyDraft } from '../session/useHistoryEncryption';
import { useT } from '../i18n';

type Props = {
  history: HistoryEncryptionSession;
  /** Opened from the "no recovery key" notice: scroll here and start
   * setting one up as soon as the state allows it. */
  autoStartRecovery?: boolean;
};
/** Showing a new recovery key before it is uploaded (docs/history-encryption.md §3.3). */
type RecoveryStep = { draft: RecoveryKeyDraft } | null;
type Confirm = { kind: 'revoke'; recipient: HistoryRecipient } | { kind: 'restore'; device: HistoryRevokedDevice } | { kind: 'resetKey' } | null;

export function RecoveryQrCode({ payload, label }: { payload: string; label: string }) {
  const qr = useMemo(() => encodeQrCode(payload), [payload]);
  const quiet = 4;
  const size = qr.size + quiet * 2;
  const path = qr.modules.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + quiet} ${y + quiet}h1v1h-1z`] : [])).join('');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className="h-44 w-44 rounded-md bg-white" shapeRendering="crispEdges">
      <path d={path} fill="#000" />
    </svg>
  );
}

function progressText(t: ReturnType<typeof useT>, progress: HistoryRewrapProgress): string {
  return t('history.progress', { processed: progress.processed, added: progress.added, skipped: progress.skipped });
}

/** History encryption for the active backend (always end-to-end): recipients,
 * recovery key, access requests from new devices, revoked devices and
 * recovery import. */
export function HistoryEncryptionPanel({ history, autoStartRecovery = false }: Props) {
  const t = useT();
  const { view, grantRuns } = history;
  const state = view.state;
  const [busy, setBusy] = useState('');
  const [step, setStep] = useState<RecoveryStep>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [importText, setImportText] = useState('');
  const [importProgress, setImportProgress] = useState<HistoryRewrapProgress | null>(null);
  const [requestedGrant, setRequestedGrant] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const autoStarted = useRef(false);

  // A recovery key never outlives the dialog that shows it.
  useEffect(() => () => { step?.draft.seed.fill(0); }, [step]);
  useEffect(() => { setStep(null); setConfirm(null); setImportProgress(null); setRequestedGrant(''); }, [view.backendId]);
  // Updates are pushed while connected; opening the panel still re-reads the
  // state in case one was missed.
  const { refresh } = history;
  useEffect(() => { void refresh(); }, [refresh, view.backendId]);

  // Opened from the notice: once per mount, as soon as the state shows a
  // recovery key is missing and this device may set one.
  const recoveryKnownMissing = view.status === 'ready' && Boolean(state) && !view.accessRevoked
    && !state?.recipients.some((item) => item.kind === 'recovery' && !item.revokedAt);
  const { createRecoveryDraft } = history;
  useEffect(() => {
    if (!autoStartRecovery || !recoveryKnownMissing || autoStarted.current) return;
    autoStarted.current = true;
    sectionRef.current?.scrollIntoView?.({ block: 'start' });
    setSavedConfirmed(false);
    setStep({ draft: createRecoveryDraft() });
  }, [autoStartRecovery, createRecoveryDraft, recoveryKnownMissing]);

  const run = async (name: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(name);
    try {
      await action();
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('history.actionFailed'));
      return false;
    } finally {
      setBusy('');
    }
  };

  if (view.status === 'idle' || (view.status === 'loading' && !state)) {
    return (
      <section aria-label={t('history.title')} className="border-separator flex flex-col gap-2 rounded-xl border p-4">
        <h4 className="text-sm font-semibold">{t('history.title')}</h4>
        <p className="text-muted flex items-center gap-2 text-xs">{view.status === 'loading' ? <Spinner size="sm" /> : null}{t(view.status === 'loading' ? 'history.loading' : 'history.connectFirst')}</p>
      </section>
    );
  }
  if (view.status === 'unavailable' || !state) {
    return (
      <section aria-label={t('history.title')} className="border-separator flex flex-col gap-2 rounded-xl border p-4">
        <h4 className="text-sm font-semibold">{t('history.title')}</h4>
        <p className="text-muted text-xs">{t('history.unavailable')}</p>
        {view.error ? <p className="text-muted text-xs">{view.error}</p> : null}
        <div><Button size="sm" variant="secondary" onPress={() => { void history.refresh(); }}>{t('history.retry')}</Button></div>
      </section>
    );
  }

  // A revoked device can only read the state until another device restores it.
  const revoked = Boolean(view.accessRevoked);
  const registered = !revoked && Boolean(view.localRid && state.myRid === view.localRid);
  const locked = Boolean(busy) || revoked;
  const activeRecipients = state.recipients.filter((item) => !item.revokedAt);
  const recovery = activeRecipients.find((item) => item.kind === 'recovery');
  const pendingGrants = state.grants.filter((grant) => grant.status === 'pending');
  const incoming = pendingGrants.filter((grant) => grant.rid !== view.localRid);
  const ownPending = pendingGrants.some((grant) => grant.rid === view.localRid);
  const recipientLabel = (item: HistoryRecipient) => item.kind === 'recovery' ? t('history.recipientRecovery')
    : item.rid === view.localRid ? t('history.recipientThisDevice')
    : t('history.recipientDevice', { device: item.deviceId ?? item.rid.slice(0, 8) });
  const ownDeviceId = state.recipients.find((item) => item.rid === view.localRid)?.deviceId;
  const deviceLabel = (device: HistoryRevokedDevice) => device.deviceId === ownDeviceId ? t('history.recipientThisDevice')
    : t('history.recipientDevice', { device: device.deviceId });

  const startRecovery = () => {
    setSavedConfirmed(false);
    setStep({ draft: history.createRecoveryDraft() });
  };
  const finishRecovery = async (draft: RecoveryKeyDraft) => {
    const ok = await run('recovery', () => history.confirmRecoveryKey(draft), t('history.recoverySaved'));
    if (ok) setStep(null);
  };

  return (
    <section ref={sectionRef} aria-label={t('history.title')} className="border-separator flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">{t('history.title')}</h4>
          <p className="text-muted mt-1 text-xs">{t('history.hint')}</p>
        </div>
        <Chip size="sm" variant="soft" color="success">{t('history.modeE2e')}</Chip>
      </div>

      {revoked ? <p role="alert" className="text-danger text-xs">{t('history.accessRevoked')}</p> : view.keyError ? (
        <div className="flex flex-col gap-2">
          <p className="text-danger text-xs">{view.keyError}</p>
          <div><Button size="sm" variant="secondary" isDisabled={locked} onPress={() => setConfirm({ kind: 'resetKey' })}>{t('history.resetKey')}</Button></div>
        </div>
      ) : !registered ? <p className="text-warning-soft-foreground text-xs">{t('history.notRegistered')}</p> : null}

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{t('history.recipients')}</p>
        {state.recipients.length ? (
          <ul className="flex flex-col gap-1.5" aria-label={t('history.recipients')}>
            {state.recipients.map((item) => (
              <li key={item.rid} className="flex items-center justify-between gap-2 text-xs">
                <span className={item.revokedAt ? 'text-muted line-through' : ''}>{recipientLabel(item)}</span>
                {item.revokedAt ? <Chip size="sm" variant="soft">{t('history.revoked')}</Chip>
                  : item.rid !== view.localRid ? (
                    <Button size="sm" variant="tertiary" isDisabled={locked} onPress={() => setConfirm({ kind: 'revoke', recipient: item })}>{t('history.revoke')}</Button>
                  ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-muted text-xs">{t('history.noRecipients')}</p>}
      </div>

      {state.revokedDevices.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t('history.revokedDevices')}</p>
          <ul className="flex flex-col gap-1.5" aria-label={t('history.revokedDevices')}>
            {state.revokedDevices.map((device) => (
              <li key={device.deviceId} className="flex items-center justify-between gap-2 text-xs">
                <span>{t('history.revokedDevice', { device: deviceLabel(device), time: device.revokedAt })}</span>
                {/* Only a device that still has access restores another. */}
                {!revoked ? (
                  <Button size="sm" variant="tertiary" isDisabled={locked} onPress={() => setConfirm({ kind: 'restore', device })}>{t('history.restore')}</Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!recovery ? <p className="text-warning-soft-foreground text-xs">{t('history.recoveryMissing')}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!recovery ? (
          <Button size="sm" variant="secondary" isDisabled={locked} onPress={startRecovery}>{t('history.createRecovery')}</Button>
        ) : null}
        <Button size="sm" variant="secondary" isDisabled={Boolean(busy) || !registered || ownPending} isPending={busy === 'request'}
          onPress={() => { void run('request', async () => setRequestedGrant(await history.requestGrant()), t('history.requested')); }}>
          {ownPending || requestedGrant ? t('history.requestPending') : t('history.requestAccess')}
        </Button>
      </div>

      {incoming.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t('history.pendingGrants')}</p>
          {incoming.map((grant) => {
            const progress = grantRuns[grant.grantId];
            return (
              <div key={grant.grantId} className="border-separator flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-xs">{t('history.grantFrom', { device: grant.deviceId || grant.rid.slice(0, 8), time: grant.requestedAt })}</p>
                {progress ? (
                  <ProgressBar aria-label={t('history.authorizing')} isIndeterminate={progress.running} value={progress.running ? undefined : 100} size="sm">
                    <Label className="text-xs">{progressText(t, progress.progress)}</Label>
                    <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
                  </ProgressBar>
                ) : null}
                {progress?.error ? <p className="text-danger text-xs">{progress.error}</p> : null}
                <div className="flex gap-2">
                  {progress?.running ? (
                    <Button size="sm" variant="tertiary" onPress={() => history.pauseGrant(grant.grantId)}>{t('history.pause')}</Button>
                  ) : (
                    <Button size="sm" isDisabled={!registered || Boolean(busy)} onPress={() => {
                      void history.authorizeGrant(grant).then(() => toast.success(t('history.authorized'))).catch((error: unknown) => {
                        toast.danger(error instanceof Error ? error.message : t('history.grantFailed'));
                      });
                    }}>{progress?.progress.cursor ? t('history.resume') : t('history.authorize')}</Button>
                  )}
                  <Button size="sm" variant="tertiary" isDisabled={progress?.running || locked} onPress={() => { void run('dismiss', () => history.dismissGrant(grant.grantId)); }}>{t('history.dismiss')}</Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <TextField value={importText} onChange={setImportText} isDisabled={busy === 'import'}>
          <Label>{t('history.importRecovery')}</Label>
          <TextArea rows={3} placeholder={t('history.importPlaceholder')} spellCheck={false} autoComplete="off" />
        </TextField>
        {importProgress ? <p className="text-muted text-xs">{progressText(t, importProgress)}</p> : null}
        <div>
          <Button size="sm" variant="secondary" isDisabled={!importText.trim() || !registered || Boolean(busy)} isPending={busy === 'import'}
            onPress={() => {
              void run('import', async () => {
                const result = await history.importRecoveryKey(importText, setImportProgress);
                setImportText('');
                setImportProgress(result);
              }, t('history.imported'));
            }}>{t('history.importAction')}</Button>
        </div>
      </div>

      <AlertDialog isOpen={step !== null} onOpenChange={(open) => { if (!open && busy !== 'recovery') setStep(null); }}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-lg">
              <AlertDialog.Header>
                <AlertDialog.Heading>{t('history.recoveryTitle')}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {step ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-muted text-sm">{t('history.recoveryHint')}</p>
                    <ol aria-label={t('history.recoveryWords')} className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-xs sm:grid-cols-4">
                      {step.draft.words.map((word, index) => <li key={index}><span className="text-muted">{index + 1}.</span> {word}</li>)}
                    </ol>
                    <div className="flex justify-center"><RecoveryQrCode payload={step.draft.qrPayload} label={t('history.recoveryQr')} /></div>
                    <Checkbox isSelected={savedConfirmed} onChange={setSavedConfirmed}>
                      <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>{t('history.recoverySavedConfirm')}</Checkbox.Content>
                    </Checkbox>
                  </div>
                ) : null}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary" isDisabled={busy === 'recovery'}>{t('common.cancel')}</Button>
                {step ? (
                  <Button isDisabled={!savedConfirmed} isPending={busy === 'recovery'} onPress={() => { void finishRecovery(step.draft); }}>{t('history.confirmRecovery')}</Button>
                ) : null}
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog isOpen={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-md">
              <AlertDialog.Header>
                <AlertDialog.Heading>{confirm?.kind === 'resetKey' ? t('history.resetKeyTitle')
                  : confirm?.kind === 'restore' ? t('history.restoreTitle') : t('history.revokeTitle')}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-muted text-sm">{confirm?.kind === 'resetKey' ? t('history.resetKeyBody')
                  : confirm?.kind === 'restore' ? t('history.restoreBody', { name: deviceLabel(confirm.device) })
                  : confirm?.kind === 'revoke' ? t(confirm.recipient.kind === 'recovery' ? 'history.revokeRecoveryBody' : 'history.revokeBody', { name: recipientLabel(confirm.recipient) }) : null}</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
                <Button variant={confirm?.kind === 'restore' ? 'primary' : 'danger'} isPending={Boolean(busy)} onPress={() => {
                  const current = confirm;
                  if (!current) return;
                  void run(current.kind, () => current.kind === 'resetKey' ? history.resetDeviceKey()
                    : current.kind === 'restore' ? history.restoreDevice(current.device.deviceId)
                    : history.revoke(current.recipient.rid), current.kind === 'restore' ? t('history.restored') : undefined).then((ok) => { if (ok) setConfirm(null); });
                }}>{confirm?.kind === 'resetKey' ? t('history.resetKey')
                  : confirm?.kind === 'restore' ? t('history.restore') : t('history.revoke')}</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </section>
  );
}

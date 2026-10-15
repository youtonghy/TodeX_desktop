import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Textarea } from '@/components/base/textarea/textarea';
import { cx } from '@/utils/cx';
import { encodeQrCode } from '@todex/protocol/qrCode';
import type { HistoryRecipient, HistoryRevokedDevice, HistoryRewrapProgress } from '@todex/protocol/historyEncryption';
import type { HistoryEncryptionBackend, RecoveryKeyDraft } from '../session/useHistoryEncryption';
import { useT } from '../i18n';
import { SETTINGS_ROW, SettingsCard, SettingsGroup, SettingsNote } from './settings/SettingsRows';
import { ConfirmDialog, Modal } from './ui/modal';
import { ProgressBar } from './ui/progress-bar';
import { Spinner, SpinnerIcon } from './ui/spinner';
import { toast } from './ui/toast';

type Props = {
  history: HistoryEncryptionBackend;
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
  // A scannable code stays black on white in both themes.
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className="h-44 w-44 rounded-md bg-white" shapeRendering="crispEdges">
      <path d={path} fill="#000" />
    </svg>
  );
}

function progressText(t: ReturnType<typeof useT>, progress: HistoryRewrapProgress): string {
  return t('history.progress', { processed: progress.processed, added: progress.added, skipped: progress.skipped });
}

/** History encryption of one backend (always end-to-end): recipients,
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
      <section aria-label={t('history.title')} className="flex flex-col gap-3">
        <HistoryHeading title={t('history.title')} />
        <SettingsCard>
          <SettingsNote className="flex items-center gap-2 py-3">{view.status === 'loading' ? <Spinner size="sm" /> : null}{t(view.status === 'loading' ? 'history.loading' : 'history.connectFirst')}</SettingsNote>
        </SettingsCard>
      </section>
    );
  }
  if (view.status === 'unavailable' || !state) {
    return (
      <section aria-label={t('history.title')} className="flex flex-col gap-3">
        <HistoryHeading title={t('history.title')} />
        <SettingsCard>
          <SettingsNote className="flex flex-col gap-2 py-3">
            <p>{t('history.unavailable')}</p>
            {view.error ? <p>{view.error}</p> : null}
            <div><Button size="small" variant="secondary" onClick={() => { void history.refresh(); }}>{t('history.retry')}</Button></div>
          </SettingsNote>
        </SettingsCard>
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

  const listRow = cx('flex min-h-11 items-center justify-between gap-2 text-body-regular text-text-primary', SETTINGS_ROW);
  return (
    <section ref={sectionRef} aria-label={t('history.title')} className="flex flex-col gap-4">
      <HistoryHeading title={t('history.title')} hint={t('history.hint')}>
        <Chip variant="caption" color="lime">{t('history.modeE2e')}</Chip>
      </HistoryHeading>

      {revoked ? <p role="alert" className="text-body-2-regular text-text-error-primary">{t('history.accessRevoked')}</p> : view.keyError ? (
        <div className="flex flex-col gap-2">
          <p className="text-body-2-regular text-text-error-primary">{view.keyError}</p>
          <div><Button size="small" variant="secondary" disabled={locked} onClick={() => setConfirm({ kind: 'resetKey' })}>{t('history.resetKey')}</Button></div>
        </div>
      ) : !registered ? <p className="text-body-2-regular text-status-yellow-text">{t('history.notRegistered')}</p> : null}

      <SettingsGroup label={t('history.recipients')} as="h4">
        <SettingsCard>
          {state.recipients.length ? (
            <ul className="flex flex-col" aria-label={t('history.recipients')}>
              {state.recipients.map((item) => (
                <li key={item.rid} className={listRow}>
                  <span className={cx('min-w-0 truncate', item.revokedAt && 'text-text-tertiary line-through')}>{recipientLabel(item)}</span>
                  {item.revokedAt ? <Chip variant="caption" color="neutral">{t('history.revoked')}</Chip>
                    : item.rid !== view.localRid ? (
                      <Button size="small" variant="secondary" disabled={locked} onClick={() => setConfirm({ kind: 'revoke', recipient: item })}>{t('history.revoke')}</Button>
                    ) : null}
                </li>
              ))}
            </ul>
          ) : <SettingsNote className="py-3">{t('history.noRecipients')}</SettingsNote>}
        </SettingsCard>
      </SettingsGroup>

      {state.revokedDevices.length ? (
        <SettingsGroup label={t('history.revokedDevices')} as="h4">
          <SettingsCard>
            <ul className="flex flex-col" aria-label={t('history.revokedDevices')}>
              {state.revokedDevices.map((device) => (
                <li key={device.deviceId} className={listRow}>
                  <span className="min-w-0">{t('history.revokedDevice', { device: deviceLabel(device), time: device.revokedAt })}</span>
                  {/* Only a device that still has access restores another. */}
                  {!revoked ? (
                    <Button size="small" variant="secondary" disabled={locked} onClick={() => setConfirm({ kind: 'restore', device })}>{t('history.restore')}</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </SettingsCard>
        </SettingsGroup>
      ) : null}

      <div className="flex flex-col gap-2">
        {!recovery ? <p className="text-body-2-regular text-status-yellow-text">{t('history.recoveryMissing')}</p> : null}
        <div className="flex flex-wrap gap-2">
          {!recovery ? (
            <Button size="small" variant="secondary" disabled={locked} onClick={startRecovery}>{t('history.createRecovery')}</Button>
          ) : null}
          <Button
            size="small"
            variant="secondary"
            leadingIcon={busy === 'request' ? SpinnerIcon : undefined}
            aria-busy={busy === 'request' || undefined}
            disabled={Boolean(busy) || !registered || ownPending}
            onClick={() => { void run('request', async () => setRequestedGrant(await history.requestGrant()), t('history.requested')); }}
          >
            {ownPending || requestedGrant ? t('history.requestPending') : t('history.requestAccess')}
          </Button>
        </div>
      </div>

      {incoming.length ? (
        <SettingsGroup label={t('history.pendingGrants')} as="h4">
          <SettingsCard>
            {incoming.map((grant) => {
              const progress = grantRuns[grant.grantId];
              return (
                <div key={grant.grantId} className={cx('flex flex-col gap-2', SETTINGS_ROW, 'py-3')}>
                  <p className="text-body-regular text-text-primary">{t('history.grantFrom', { device: grant.deviceId || grant.rid.slice(0, 8), time: grant.requestedAt })}</p>
                  {progress ? (
                    <ProgressBar
                      aria-label={t('history.authorizing')}
                      label={<span className="text-body-2-regular text-text-secondary">{progressText(t, progress.progress)}</span>}
                      showValue={false}
                      value={progress.running ? undefined : 100}
                    />
                  ) : null}
                  {progress?.error ? <p className="text-body-2-regular text-text-error-primary">{progress.error}</p> : null}
                  <div className="flex gap-2">
                    {progress?.running ? (
                      <Button size="small" variant="secondary" onClick={() => history.pauseGrant(grant.grantId)}>{t('history.pause')}</Button>
                    ) : (
                      <Button size="small" disabled={!registered || Boolean(busy)} onClick={() => {
                        void history.authorizeGrant(grant).then(() => toast.success(t('history.authorized'))).catch((error: unknown) => {
                          toast.danger(error instanceof Error ? error.message : t('history.grantFailed'));
                        });
                      }}>{progress?.progress.cursor ? t('history.resume') : t('history.authorize')}</Button>
                    )}
                    <Button size="small" variant="secondary" disabled={progress?.running || locked} onClick={() => { void run('dismiss', () => history.dismissGrant(grant.grantId)); }}>{t('history.dismiss')}</Button>
                  </div>
                </div>
              );
            })}
          </SettingsCard>
        </SettingsGroup>
      ) : null}

      <SettingsCard>
        <div className={cx('flex flex-col gap-2', SETTINGS_ROW, 'py-3')}>
          <Textarea
            label={t('history.importRecovery')}
            rows={3}
            placeholder={t('history.importPlaceholder')}
            spellCheck="false"
            autoComplete="off"
            value={importText}
            onChange={setImportText}
            isDisabled={busy === 'import'}
          />
          {importProgress ? <p className="text-body-2-regular text-text-secondary">{progressText(t, importProgress)}</p> : null}
          <div>
            <Button
              size="small"
              variant="secondary"
              leadingIcon={busy === 'import' ? SpinnerIcon : undefined}
              aria-busy={busy === 'import' || undefined}
              disabled={!importText.trim() || !registered || Boolean(busy)}
              onClick={() => {
                void run('import', async () => {
                  const result = await history.importRecoveryKey(importText, setImportProgress);
                  setImportText('');
                  setImportProgress(result);
                }, t('history.imported'));
              }}
            >
              {t('history.importAction')}
            </Button>
          </div>
        </div>
      </SettingsCard>

      <Modal
        isOpen={step !== null}
        onOpenChange={(open) => { if (!open && busy !== 'recovery') setStep(null); }}
        title={t('history.recoveryTitle')}
        size="lg"
        isDismissable={false}
        hideCloseButton
        footer={(
          <>
            <Button variant="secondary" disabled={busy === 'recovery'} onClick={() => { if (busy !== 'recovery') setStep(null); }}>{t('common.cancel')}</Button>
            {step ? (
              <Button
                leadingIcon={busy === 'recovery' ? SpinnerIcon : undefined}
                aria-busy={busy === 'recovery' || undefined}
                disabled={!savedConfirmed || busy === 'recovery'}
                onClick={() => { void finishRecovery(step.draft); }}
              >
                {t('history.confirmRecovery')}
              </Button>
            ) : null}
          </>
        )}
      >
        {step ? (
          <div className="flex flex-col gap-3">
            <p className="text-body-regular text-text-secondary">{t('history.recoveryHint')}</p>
            <ol aria-label={t('history.recoveryWords')} className="grid grid-cols-3 gap-x-3 gap-y-1 font-mono text-caption-1-regular text-text-primary sm:grid-cols-4">
              {step.draft.words.map((word, index) => <li key={index}><span className="text-text-tertiary">{index + 1}.</span> {word}</li>)}
            </ol>
            <div className="flex justify-center"><RecoveryQrCode payload={step.draft.qrPayload} label={t('history.recoveryQr')} /></div>
            <Checkbox isSelected={savedConfirmed} onChange={setSavedConfirmed}>{t('history.recoverySavedConfirm')}</Checkbox>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        isOpen={confirm !== null}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={confirm?.kind === 'resetKey' ? t('history.resetKeyTitle')
          : confirm?.kind === 'restore' ? t('history.restoreTitle') : t('history.revokeTitle')}
        description={confirm?.kind === 'resetKey' ? t('history.resetKeyBody')
          : confirm?.kind === 'restore' ? t('history.restoreBody', { name: deviceLabel(confirm.device) })
          : confirm?.kind === 'revoke' ? t(confirm.recipient.kind === 'recovery' ? 'history.revokeRecoveryBody' : 'history.revokeBody', { name: recipientLabel(confirm.recipient) }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={confirm?.kind === 'resetKey' ? t('history.resetKey')
          : confirm?.kind === 'restore' ? t('history.restore') : t('history.revoke')}
        tone={confirm?.kind === 'restore' ? 'default' : 'danger'}
        isPending={Boolean(busy)}
        onConfirm={() => {
          const current = confirm;
          if (!current) return;
          void run(current.kind, () => current.kind === 'resetKey' ? history.resetDeviceKey()
            : current.kind === 'restore' ? history.restoreDevice(current.device.deviceId)
            : history.revoke(current.recipient.rid), current.kind === 'restore' ? t('history.restored') : undefined).then((ok) => { if (ok) setConfirm(null); });
        }}
      />
    </section>
  );
}

/** The section's title and hint, with an optional trailing badge. */
function HistoryHeading({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-headline-medium text-text-primary">{title}</h3>
        {hint ? <p className="mt-1 text-body-2-regular text-text-secondary">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RiAddLine, RiArrowLeftRightLine, RiDeleteBinLine, RiEdit2Line, RiFileCopyLine, RiGlobalLine, RiPlayLine, RiStopLine,
} from '@remixicon/react';
import {
  SSH_FORWARD_DEFAULT_BIND_ADDRESS, formatSshHostPort, isNotFoundError,
  type SshForward, type SshForwardStatus, type SshHost, type SshIpAssignment, type SshIpPool,
} from '@todex/protocol/ssh';
import { useT, type MessageKey } from '../../i18n';
import { SshForwardDialog, SSH_FORWARD_KIND_LABEL_KEYS } from './SshForwardDialog';
import { SshIpAssignmentDialog } from './SshIpAssignmentDialog';
import { SshIpPoolSection } from './SshIpPoolSection';
import { withSshPassword, type AskSshPassword, type RememberSshPassword } from './sshPasswordFlow';
import { SSH_FAILURE_LABEL_KEYS, copyText, errorMessage, formatIsoTimestamp, type SshApi } from './sshShared';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmDialog } from '@/components/ui/modal';
import { Spinner, SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

const GROUP = 'flex flex-col rounded-2xl bg-background-secondary-default ps-3';
const ROW = 'flex min-w-0 flex-col gap-1.5 border-b border-separator-border py-2.5 pe-2.5 last:border-b-0';
const POLL_MS = 3000;

const STATUS_CHIPS: Record<SshForwardStatus, { key: MessageKey; color: 'lime' | 'rose' | 'blue' | 'neutral' }> = {
  stopped: { key: 'ssh.forwards.status.stopped', color: 'neutral' },
  starting: { key: 'ssh.forwards.status.starting', color: 'blue' },
  running: { key: 'ssh.forwards.status.running', color: 'lime' },
  failed: { key: 'ssh.forwards.status.failed', color: 'rose' },
};

/** Opens a dialog from elsewhere in the SSH view (the host row menu). */
export type SshForwardsRequest = { id: number; kind: 'forward' | 'ip'; alias: string };

/** Local side of a forward as a client would dial it. */
function forwardAddress(forward: SshForward): string {
  return formatSshHostPort(forward.bindAddress || SSH_FORWARD_DEFAULT_BIND_ADDRESS, forward.bindPort);
}

function forwardRoute(forward: SshForward): string {
  const bind = forward.kind === 'remote' && !forward.bindAddress ? `:${forward.bindPort}` : forwardAddress(forward);
  if (forward.kind === 'dynamic') return `${bind} → SOCKS`;
  return `${bind} → ${formatSshHostPort(forward.targetHost ?? '', forward.targetPort ?? 0)}`;
}

type PendingDelete = { kind: 'forward'; forward: SshForward } | { kind: 'assignment'; assignment: SshIpAssignment };

type Props = {
  api: SshApi;
  backendId: string;
  hosts: SshHost[];
  askPassword: AskSshPassword;
  rememberPassword: RememberSshPassword;
  /** Opens a running local forward in a Workbench browser tab; absent when unavailable. */
  onOpenBrowser?: (url: string) => void;
  request: SshForwardsRequest | null;
  onRequestHandled: () => void;
};

/**
 * Manual port forwards and the loopback IP pool. Both lists poll every 3 s
 * while this tab is mounted (the selected SSH tab) and the window is visible.
 */
export function SshForwardsTab({ api, backendId, hosts, askPassword, rememberPassword, onOpenBrowser, request, onRequestHandled }: Props) {
  const t = useT();
  const [forwards, setForwards] = useState<SshForward[] | null>(null);
  const [pool, setPool] = useState<SshIpPool | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [poolUnsupported, setPoolUnsupported] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [forwardDialog, setForwardDialog] = useState<{ forward?: SshForward; alias?: string } | null>(null);
  const [ipDialog, setIpDialog] = useState<{ assignment?: SshIpAssignment; alias?: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);

  const reload = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const generation = generationRef.current;
    try {
      const [forwardsResult, poolResult] = await Promise.allSettled([api().listSshForwards(), api().getSshIpPool()]);
      if (generation !== generationRef.current) return;
      let failure = '';
      if (forwardsResult.status === 'fulfilled') {
        setForwards(forwardsResult.value.forwards);
        setUnsupported(false);
      } else if (isNotFoundError(forwardsResult.reason)) setUnsupported(true);
      else failure = errorMessage(forwardsResult.reason, t('ssh.forwards.loadFailed'));
      if (poolResult.status === 'fulfilled') {
        setPool(poolResult.value);
        setPoolUnsupported(false);
      } else if (isNotFoundError(poolResult.reason)) setPoolUnsupported(true);
      else failure ||= errorMessage(poolResult.reason, t('ssh.forwards.loadFailed'));
      setLoadError(failure);
      setLoaded(true);
    } finally {
      inFlightRef.current = false;
    }
  }, [api, t]);

  useEffect(() => {
    // A backend switch invalidates the lists and in-flight responses.
    generationRef.current += 1;
    inFlightRef.current = false;
    setForwards(null);
    setPool(null);
    setUnsupported(false);
    setPoolUnsupported(false);
    setLoadError('');
    setLoaded(false);
    void reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, POLL_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reload]);

  useEffect(() => {
    if (!request || !loaded) return;
    onRequestHandled();
    if (unsupported) return;
    if (request.kind === 'forward') {
      setForwardDialog({ alias: request.alias });
      return;
    }
    if (!pool) return;
    const existing = pool.assignments.find((item) => item.alias === request.alias);
    setIpDialog(existing ? { assignment: existing } : { alias: request.alias });
  }, [loaded, onRequestHandled, pool, request, unsupported]);

  const setForwardBusy = (id: string, value: boolean) => setBusy((current) => ({ ...current, [id]: value }));
  const replaceForward = (next: SshForward) => setForwards((current) => current?.map((item) => item.id === next.id ? next : item) ?? current);

  const start = async (forward: SshForward) => {
    const host = hosts.find((item) => item.alias === forward.alias);
    setForwardBusy(forward.id, true);
    try {
      const result = await withSshPassword({
        backendId,
        alias: forward.alias,
        passwordHost: host?.managed?.authMethod === 'password',
        askPassword,
        rememberPassword,
        attempt: async (password) => {
          const next = (await api().startSshForward(forward.id, password)).forward;
          replaceForward(next);
          return next;
        },
        needsPassword: (next) => next.status === 'failed' && next.failure === 'authenticationFailed',
        succeeded: (next) => next.status === 'running',
        wrongPasswordMessage: t('ssh.remote.authFailed'),
      });
      if (result?.status === 'failed') toast.danger(t('ssh.forwards.startFailed'));
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.forwards.startFailed')));
    } finally {
      setForwardBusy(forward.id, false);
      void reload();
    }
  };

  const stop = async (forward: SshForward) => {
    setForwardBusy(forward.id, true);
    try {
      replaceForward((await api().stopSshForward(forward.id)).forward);
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.forwards.stopFailed')));
    } finally {
      setForwardBusy(forward.id, false);
      void reload();
    }
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      if (target.kind === 'forward') await api().deleteSshForward(target.forward.id);
      else await api().deleteSshIpAssignment(target.assignment.ip);
    } catch (error) {
      if (!isNotFoundError(error)) toast.danger(errorMessage(error, t('ssh.deleteFailed')));
    }
    void reload();
  };

  if (unsupported) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <EmptyState icon={RiArrowLeftRightLine} title={t('ssh.forwards.unsupportedTitle')} description={t('ssh.forwards.unsupportedHint')} />
      </div>
    );
  }
  if (!loaded) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('app.loading')} /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      {loadError ? <Alert status="danger" title={t('ssh.forwards.loadFailed')} description={loadError} /> : null}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-body-semibold text-text-primary">{t('ssh.forwards.title')}</h3>
            <p className="text-caption-1-regular text-text-tertiary">{t('ssh.forwards.intro')}</p>
          </div>
          <Button size="small" leadingIcon={RiAddLine} disabled={!hosts.length} onClick={() => setForwardDialog({})}>{t('ssh.forwards.add')}</Button>
        </div>
        {!forwards?.length ? (
          <EmptyState size="sm" icon={RiArrowLeftRightLine} title={t('ssh.forwards.emptyTitle')} description={t('ssh.forwards.emptyHint')} />
        ) : (
          <div className={GROUP}>
            {forwards.map((forward) => {
              const status = STATUS_CHIPS[forward.status];
              const active = forward.status === 'running' || forward.status === 'starting';
              const pending = busy[forward.id] || forward.status === 'starting';
              const address = forwardAddress(forward);
              const startedAt = forward.status === 'running' ? formatIsoTimestamp(forward.startedAt) : '';
              const route = forwardRoute(forward);
              return (
                <div key={forward.id} className={ROW}>
                  <div className="flex min-w-0 items-center gap-3">
                    <RiArrowLeftRightLine aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {forward.label ? (
                          <span className="truncate text-body-medium text-text-primary">{forward.label}</span>
                        ) : (
                          <bdi dir="ltr" className="truncate font-mono text-body-medium text-text-primary">{route}</bdi>
                        )}
                        <Chip variant="caption" color="neutral">{t(SSH_FORWARD_KIND_LABEL_KEYS[forward.kind])}</Chip>
                        <Chip variant="caption" color={status.color}>{t(status.key)}</Chip>
                      </div>
                      <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-body-2-regular text-text-secondary">
                        <span className="truncate">{forward.alias}</span>
                        {forward.label ? (
                          <>
                            <span aria-hidden>·</span>
                            <bdi dir="ltr" className="truncate font-mono">{route}</bdi>
                          </>
                        ) : null}
                        {startedAt ? (
                          <>
                            <span aria-hidden>·</span>
                            <span>{t('ssh.forwards.startedAt', { time: startedAt })}</span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {forward.status === 'running' && forward.kind !== 'remote' ? (
                        <IconAction
                          icon={RiFileCopyLine}
                          size="sm"
                          aria-label={t('ssh.forwards.copyAddress')}
                          tooltip
                          onClick={() => void copyText(forward.kind === 'dynamic' ? `socks5h://${address}` : address, t('common.copied'), t('chat.copyFailed'))}
                        />
                      ) : null}
                      {forward.status === 'running' && forward.kind === 'local' && onOpenBrowser ? (
                        <IconAction icon={RiGlobalLine} size="sm" aria-label={t('ssh.forwards.openBrowser')} tooltip onClick={() => onOpenBrowser(`http://${address}/`)} />
                      ) : null}
                      {active ? (
                        <IconAction
                          icon={busy[forward.id] ? SpinnerIcon : RiStopLine}
                          size="sm"
                          aria-label={t('ssh.forwards.stop')}
                          tooltip
                          disabled={busy[forward.id]}
                          onClick={() => void stop(forward)}
                        />
                      ) : (
                        <IconAction
                          icon={pending ? SpinnerIcon : RiPlayLine}
                          size="sm"
                          aria-label={t('ssh.forwards.start')}
                          tooltip
                          disabled={pending}
                          onClick={() => void start(forward)}
                        />
                      )}
                      <IconAction
                        icon={RiEdit2Line}
                        size="sm"
                        aria-label={active ? t('ssh.forwards.editStopFirst') : t('ssh.edit')}
                        tooltip
                        disabled={active}
                        onClick={() => setForwardDialog({ forward })}
                      />
                      <IconAction icon={RiDeleteBinLine} size="sm" aria-label={t('common.delete')} tooltip onClick={() => setPendingDelete({ kind: 'forward', forward })} />
                    </div>
                  </div>
                  {forward.status === 'failed' ? (
                    <p className="break-words ps-8 text-caption-1-regular text-text-error-primary">
                      {t(SSH_FAILURE_LABEL_KEYS[forward.failure ?? 'other'])}
                      {forward.error ? <span className="ms-1 font-mono opacity-80">{forward.error}</span> : null}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {poolUnsupported ? (
        <EmptyState size="sm" icon={RiArrowLeftRightLine} title={t('ssh.forwards.unsupportedTitle')} description={t('ssh.forwards.unsupportedHint')} />
      ) : pool ? (
        <SshIpPoolSection
          api={api}
          backendId={backendId}
          hosts={hosts}
          pool={pool}
          askPassword={askPassword}
          rememberPassword={rememberPassword}
          onPoolChange={setPool}
          onReload={() => void reload()}
          onAssign={() => setIpDialog({})}
          onEditAssignment={(assignment) => setIpDialog({ assignment })}
          onRemoveAssignment={(assignment) => setPendingDelete({ kind: 'assignment', assignment })}
        />
      ) : null}

      {forwardDialog ? (
        <SshForwardDialog
          api={api}
          hosts={hosts}
          forward={forwardDialog.forward}
          initialAlias={forwardDialog.alias}
          onClose={() => setForwardDialog(null)}
          onSaved={() => void reload()}
        />
      ) : null}
      {ipDialog && pool ? (
        <SshIpAssignmentDialog
          api={api}
          hosts={hosts}
          pool={pool}
          assignment={ipDialog.assignment}
          initialAlias={ipDialog.alias}
          onClose={() => setIpDialog(null)}
          onSaved={() => void reload()}
        />
      ) : null}
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title={t('ssh.deleteTitle')}
        description={pendingDelete?.kind === 'forward'
          ? t('ssh.forwards.deleteBody', { route: forwardRoute(pendingDelete.forward), alias: pendingDelete.forward.alias })
          : pendingDelete ? t('ssh.ipPool.removeBody', { ip: pendingDelete.assignment.ip, alias: pendingDelete.assignment.alias }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        tone="danger"
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

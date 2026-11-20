import { useState } from 'react';
import { RiServerLine } from '@remixicon/react';
import { isNotFoundError, type SshHost, type SshKey, type SshKeyDeployResult, type SshPasswordLoginReason } from '@todex/protocol/ssh';
import { useT, type MessageKey } from '../../i18n';
import { saveSshPassword } from '../../lib/sshPasswordStore';
import { withSshPassword, type AskSshPassword } from './sshPasswordFlow';
import { SSH_FAILURE_LABEL_KEYS, errorMessage, type SshApi } from './sshShared';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { cx } from '@/utils/cx';

/** How a host relates to the key being deployed. */
type HostKind = 'password' | 'otherKey' | 'current' | 'readOnly';

type RowStatus =
  | { state: 'waiting' | 'running' | 'skipped' }
  | { state: 'done' | 'failed'; result: SshKeyDeployResult };

const REASON_KEYS: Record<SshPasswordLoginReason, MessageKey> = {
  notVerified: 'ssh.keys.deploy.reason.notVerified',
  unsupportedOs: 'ssh.keys.deploy.reason.unsupportedOs',
  noSshd: 'ssh.keys.deploy.reason.noSshd',
  configInvalid: 'ssh.keys.deploy.reason.configInvalid',
  restartFailed: 'ssh.keys.deploy.reason.restartFailed',
  stillEnabled: 'ssh.keys.deploy.reason.stillEnabled',
  needsRoot: 'ssh.keys.deploy.reason.needsRoot',
  connection: 'ssh.keys.deploy.reason.connection',
  other: 'ssh.keys.deploy.reason.other',
};

function hostKind(host: SshHost, key: SshKey): HostKind {
  if (host.source !== 'managed' || !host.managed) return 'readOnly';
  if (host.managed.authMethod === 'password') return 'password';
  return key.usedBy.includes(host.alias) ? 'current' : 'otherKey';
}

/**
 * Installs `sshKey` on the chosen managed hosts one after another and
 * switches each to it; password hosts are picked by default, hosts on
 * another key need a confirmation. Optionally turns off the servers'
 * password login. Mounted only while open.
 */
export function SshKeyDeployDialog({ api, backendId, sshKey, hosts, askPassword, onClose, onDeployed }: {
  api: SshApi;
  backendId: string;
  sshKey: SshKey;
  hosts: SshHost[];
  askPassword: AskSshPassword;
  onClose: () => void;
  /** Hosts or keys changed; reload them. */
  onDeployed: () => void;
}) {
  const t = useT();
  const rows = hosts.map((host) => ({ host, kind: hostKind(host, sshKey) }));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rows.filter((row) => row.kind === 'password').map((row) => row.host.alias)),
  );
  const [disablePassword, setDisablePassword] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [phase, setPhase] = useState<'select' | 'running' | 'finished'>('select');
  const [unsupported, setUnsupported] = useState(false);

  const chosen = rows.filter((row) => selected.has(row.host.alias));
  const overwrites = chosen.filter((row) => row.kind === 'otherKey');

  const toggle = (alias: string, on: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (on) next.add(alias);
    else next.delete(alias);
    return next;
  });

  const setStatus = (alias: string, status: RowStatus) => setStatuses((current) => ({ ...current, [alias]: status }));

  const start = () => {
    if (overwrites.length > 0 || disablePassword) setConfirming(true);
    else void run();
  };

  const run = async () => {
    setConfirming(false);
    setPhase('running');
    setStatuses(Object.fromEntries(chosen.map((row) => [row.host.alias, { state: 'waiting' } satisfies RowStatus])));
    let changed = false;
    for (const { host, kind } of chosen) {
      const alias = host.alias;
      setStatus(alias, { state: 'running' });
      try {
        const result = await withSshPassword({
          backendId,
          alias,
          passwordHost: kind === 'password',
          askPassword,
          // The host signs in with the key from now on.
          rememberPassword: async () => undefined,
          attempt: (password) => api().deploySshKey(sshKey.name, { alias, password, disablePasswordLogin: disablePassword }),
          needsPassword: (next) => !next.ok && next.stage === 'install' && next.failure === 'authenticationFailed',
          succeeded: (next) => next.ok,
          wrongPasswordMessage: t('ssh.remote.authFailed'),
        });
        if (!result) {
          setStatus(alias, { state: 'skipped' });
          continue;
        }
        setStatus(alias, { state: result.ok ? 'done' : 'failed', result });
        if (result.ok) {
          changed = true;
          if (kind === 'password') await saveSshPassword(backendId, alias, null).catch(() => undefined);
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          setUnsupported(true);
          setStatuses((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value.state === 'done' || value.state === 'failed' ? value : { state: 'skipped' }])));
          break;
        }
        setStatus(alias, {
          state: 'failed',
          result: { ok: false, durationMs: 0, stage: 'install', detail: errorMessage(error, t('ssh.keys.deploy.failed')), alreadyInstalled: false, verified: false },
        });
      }
    }
    setPhase('finished');
    if (changed) onDeployed();
  };

  const running = phase === 'running';
  const selectable = phase === 'select';

  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open && !running) onClose(); }}
      isDismissable={!running}
      isKeyboardDismissDisabled={running}
      title={t('ssh.keys.deploy.title', { name: sshKey.name })}
      description={t('ssh.keys.deploy.description')}
      size="lg"
      className="max-h-[90vh]"
      bodyClassName="flex flex-col gap-4"
      footer={selectable ? (
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={chosen.length === 0} onClick={start}>{t('ssh.keys.deploy.start', { count: chosen.length })}</Button>
        </>
      ) : (
        <Button disabled={running} leadingIcon={running ? SpinnerIcon : undefined} aria-busy={running || undefined} onClick={onClose}>
          {t('common.close')}
        </Button>
      )}
    >
      {unsupported ? <Alert status="warning" title={t('ssh.keys.deploy.unsupported')} /> : null}
      {rows.length === 0 ? (
        <EmptyState size="sm" icon={RiServerLine} title={t('ssh.keys.deploy.noHosts')} />
      ) : (
        <ul className="flex flex-col divide-y divide-separator-border rounded-xl border border-border-button-default" aria-label={t('ssh.keys.deploy.hosts')}>
          {rows.map(({ host, kind }) => (
            <li key={host.alias} className="flex items-start gap-3 px-3 py-2.5">
              <Checkbox
                className="mt-0.5"
                aria-label={host.alias}
                isSelected={selected.has(host.alias)}
                isDisabled={!selectable || kind === 'current' || kind === 'readOnly'}
                onChange={(on) => toggle(host.alias, on)}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-body-medium text-text-primary">{host.alias}</span>
                  <HostKindChip host={host} kind={kind} />
                </div>
                <HostStatus status={statuses[host.alias]} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1">
        <Checkbox isSelected={disablePassword} isDisabled={!selectable} onChange={setDisablePassword}>
          {t('ssh.keys.deploy.disablePassword')}
        </Checkbox>
        <p className="ps-6 text-caption-1-regular text-text-tertiary">{t('ssh.keys.deploy.disablePasswordHint')}</p>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={t('ssh.keys.deploy.confirmTitle')}
        tone={disablePassword ? 'danger' : 'default'}
        confirmLabel={t('ssh.keys.deploy.confirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void run()}
      >
        <div className="flex flex-col gap-3 text-body-regular text-text-secondary">
          {overwrites.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p>{t('ssh.keys.deploy.confirmOverwrite', { name: sshKey.name })}</p>
              <ul className="list-disc ps-5 text-text-primary">
                {overwrites.map(({ host }) => <li key={host.alias}>{host.alias}</li>)}
              </ul>
              <p className="text-caption-1-regular text-text-tertiary">{t('ssh.keys.deploy.confirmOverwriteNote')}</p>
            </div>
          ) : null}
          {disablePassword ? (
            <Alert status="danger" title={t('ssh.keys.deploy.confirmDisableTitle')} description={t('ssh.keys.deploy.confirmDisable', { name: sshKey.name })} />
          ) : null}
        </div>
      </ConfirmDialog>
    </Modal>
  );
}

function HostKindChip({ host, kind }: { host: SshHost; kind: HostKind }) {
  const t = useT();
  switch (kind) {
    case 'password':
      return <Chip variant="caption" color="yellow">{t('ssh.keys.deploy.passwordHost')}</Chip>;
    case 'current':
      return <Chip variant="caption" color="lime">{t('ssh.keys.deploy.current')}</Chip>;
    case 'readOnly':
      return <Chip variant="caption" color="neutral">{t('ssh.keys.deploy.readOnly')}</Chip>;
    case 'otherKey': {
      const file = host.managed?.identityFile;
      return (
        <Chip variant="caption" color="blue" className="max-w-full truncate" title={file}>
          {file ? t('ssh.keys.deploy.keyHost', { file: file.split(/[\\/]/).pop() ?? file }) : t('ssh.keys.deploy.keyHostDefault')}
        </Chip>
      );
    }
  }
}

const STATUS_TONES = {
  secondary: 'text-text-secondary',
  tertiary: 'text-text-tertiary',
  error: 'text-text-error-primary',
} as const;

function HostStatus({ status }: { status?: RowStatus }) {
  const t = useT();
  if (!status) return null;
  const line = (text: string, tone: keyof typeof STATUS_TONES = 'secondary') => (
    <p className={cx('text-caption-1-regular', STATUS_TONES[tone])}>{text}</p>
  );
  switch (status.state) {
    case 'waiting':
      return line(t('ssh.keys.deploy.waiting'), 'tertiary');
    case 'running':
      return (
        <p className="flex items-center gap-1.5 text-caption-1-regular text-text-secondary">
          <SpinnerIcon className="size-3.5" />
          {t('ssh.keys.deploy.running')}
        </p>
      );
    case 'skipped':
      return line(t('ssh.keys.deploy.skipped'), 'tertiary');
    case 'failed': {
      const { result } = status;
      const what = result.stage === 'verify' ? t('ssh.keys.deploy.stageVerify') : t('ssh.keys.deploy.stageInstall');
      const why = result.failure ? t(SSH_FAILURE_LABEL_KEYS[result.failure]) : undefined;
      return (
        <>
          {line(why ? `${what}: ${why}` : what, 'error')}
          {result.detail ? <p className="break-words font-mono text-caption-1-regular text-text-tertiary">{result.detail}</p> : null}
        </>
      );
    }
    case 'done': {
      const { result } = status;
      const login = result.passwordLogin;
      return (
        <>
          {line(result.alreadyInstalled ? `${t('ssh.keys.deploy.done')} · ${t('ssh.keys.deploy.alreadyInstalled')}` : t('ssh.keys.deploy.done'))}
          {!result.verified ? line(t('ssh.keys.deploy.unverified'), 'tertiary') : null}
          {login?.status === 'disabled' ? line(t('ssh.keys.deploy.pwDisabled')) : null}
          {login?.status === 'skipped' ? line(t('ssh.keys.deploy.pwSkipped'), 'tertiary') : null}
          {login?.status === 'failed' ? (
            <>
              {line(t('ssh.keys.deploy.pwFailed', { reason: t(REASON_KEYS[login.reason ?? 'other']) }), 'error')}
              {login.detail ? <p className="break-words font-mono text-caption-1-regular text-text-tertiary">{login.detail}</p> : null}
            </>
          ) : null}
        </>
      );
    }
  }
}

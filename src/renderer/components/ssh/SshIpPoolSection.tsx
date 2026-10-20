import { useEffect, useState } from 'react';
import { Focusable } from 'react-aria-components';
import { RiAddLine, RiDeleteBinLine, RiEdit2Line, RiFileCopyLine, RiLinkM, RiLinkUnlink, RiRouterLine } from '@remixicon/react';
import {
  SSH_IP_POOL_IDLE_MINUTES_RANGE,
  type SshHost, type SshIpAssignment, type SshIpAssignmentState, type SshIpPool,
} from '@todex/protocol/ssh';
import { useT, type MessageKey } from '../../i18n';
import { SSH_FAILURE_LABEL_KEYS, copyText, errorMessage, formatIsoTimestamp, type SshApi } from './sshShared';
import { withSshPassword, type AskSshPassword, type RememberSshPassword } from './sshPasswordFlow';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Switch } from '@/components/base/switch/switch';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { Alert } from '@/components/ui/alert';
import { CodeBlock } from '@/components/ui/code-block';
import { IconAction } from '@/components/ui/icon-action';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

/** BoardUI settings-row recipe: a grouped secondary card of hairline rows. */
const GROUP = 'flex flex-col rounded-2xl bg-background-secondary-default ps-3';
const ROW = 'flex min-w-0 flex-col gap-2 border-b border-separator-border py-2.5 pe-2.5 last:border-b-0';

type ChipColor = 'lime' | 'rose' | 'yellow' | 'blue' | 'neutral' | 'soft';

const STATE_CHIPS: Record<SshIpAssignmentState, { key: MessageKey; color: ChipColor }> = {
  disabled: { key: 'ssh.ipPool.state.disabled', color: 'neutral' },
  idle: { key: 'ssh.ipPool.state.idle', color: 'soft' },
  connecting: { key: 'ssh.ipPool.state.connecting', color: 'blue' },
  connected: { key: 'ssh.ipPool.state.connected', color: 'lime' },
  needsLogin: { key: 'ssh.ipPool.state.needsLogin', color: 'yellow' },
  failed: { key: 'ssh.ipPool.state.failed', color: 'rose' },
};

type Props = {
  api: SshApi;
  backendId: string;
  hosts: SshHost[];
  pool: SshIpPool;
  askPassword: AskSshPassword;
  rememberPassword: RememberSshPassword;
  onPoolChange: (pool: SshIpPool) => void;
  onReload: () => void;
  onAssign: () => void;
  onEditAssignment: (assignment: SshIpAssignment) => void;
  onRemoveAssignment: (assignment: SshIpAssignment) => void;
};

/**
 * Loopback IP pool: every assigned IP listens on its port set on the backend
 * machine and forwards each connection to the same port on the host.
 */
export function SshIpPoolSection({ api, backendId, hosts, pool, askPassword, rememberPassword, onPoolChange, onReload, onAssign, onEditAssignment, onRemoveAssignment }: Props) {
  const t = useT();
  const [cidr, setCidr] = useState(pool.cidr);
  const [idleMinutes, setIdleMinutes] = useState(String(pool.idleMinutes));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Polling refreshes the form until the user edits it.
  useEffect(() => {
    if (dirty) return;
    setCidr(pool.cidr);
    setIdleMinutes(String(pool.idleMinutes));
  }, [dirty, pool.cidr, pool.idleMinutes]);

  const saveConfig = async (next: { enabled: boolean; cidr: string; idleMinutes: number }) => {
    setSaving(true);
    try {
      onPoolChange(await api().updateSshIpPool(next));
      setDirty(false);
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.ipPool.settingsFailed')));
    } finally {
      setSaving(false);
    }
  };

  const submitSettings = () => {
    const minutes = Number(idleMinutes.trim());
    const { min, max } = SSH_IP_POOL_IDLE_MINUTES_RANGE;
    if (!Number.isInteger(minutes) || minutes < min || minutes > max) return toast.danger(t('ssh.ipPool.idleInvalid', { min, max }));
    if (!cidr.trim()) return toast.danger(t('ssh.ipPool.cidrRequired'));
    void saveConfig({ enabled: pool.enabled, cidr: cidr.trim(), idleMinutes: minutes });
  };

  const setAssignmentBusy = (ip: string, value: boolean) => setBusy((current) => ({ ...current, [ip]: value }));

  const connect = async (assignment: SshIpAssignment) => {
    const host = hosts.find((item) => item.alias === assignment.alias);
    setAssignmentBusy(assignment.ip, true);
    try {
      const result = await withSshPassword({
        backendId,
        alias: assignment.alias,
        passwordHost: host?.managed?.authMethod === 'password',
        askPassword,
        rememberPassword,
        attempt: async (password) => (await api().connectSshIpAssignment(assignment.ip, password)).assignment,
        needsPassword: (next) => next.failure === 'authenticationFailed' || next.state === 'needsLogin',
        succeeded: (next) => next.state === 'connected',
        wrongPasswordMessage: t('ssh.remote.authFailed'),
      });
      if (result && result.state === 'failed') toast.danger(result.error || t(SSH_FAILURE_LABEL_KEYS[result.failure ?? 'other']));
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.ipPool.connectFailed')));
    } finally {
      setAssignmentBusy(assignment.ip, false);
      onReload();
    }
  };

  const disconnect = async (assignment: SshIpAssignment) => {
    setAssignmentBusy(assignment.ip, true);
    try {
      await api().disconnectSshIpAssignment(assignment.ip);
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.ipPool.disconnectFailed')));
    } finally {
      setAssignmentBusy(assignment.ip, false);
      onReload();
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-body-semibold text-text-primary">{t('ssh.ipPool.title')}</h3>
        <p className="text-caption-1-regular text-text-tertiary">{t('ssh.ipPool.intro')}</p>
      </div>
      {!pool.supported ? (
        <Alert status="warning" title={t('ssh.ipPool.unsupported')} description={pool.unsupportedReason} />
      ) : null}
      <div className={GROUP}>
        <div className="flex min-h-[52px] min-w-0 items-center gap-3 border-b border-separator-border py-2.5 pe-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-body-medium text-text-primary">{t('ssh.ipPool.enable')}</p>
            <p className="text-body-2-regular text-text-secondary">{t('ssh.ipPool.enableHint')}</p>
          </div>
          <Switch
            size="sm"
            aria-label={t('ssh.ipPool.enable')}
            isSelected={pool.enabled}
            isDisabled={saving || (!pool.supported && !pool.enabled)}
            onChange={(enabled) => void saveConfig({ enabled, cidr: pool.cidr, idleMinutes: pool.idleMinutes })}
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-3 py-2.5 pe-2.5">
          <Input
            className="min-w-48 flex-1"
            label={t('ssh.ipPool.cidr')}
            hint={t('ssh.ipPool.cidrHint')}
            inputDir="ltr"
            value={cidr}
            onChange={(value) => { setCidr(value); setDirty(true); }}
          />
          <Input
            className="w-36"
            label={t('ssh.ipPool.idleMinutes')}
            hint={t('ssh.ipPool.idleHint', { min: SSH_IP_POOL_IDLE_MINUTES_RANGE.min, max: SSH_IP_POOL_IDLE_MINUTES_RANGE.max })}
            inputMode="numeric"
            value={idleMinutes}
            onChange={(value) => { setIdleMinutes(value); setDirty(true); }}
          />
          <div className="flex gap-2 pb-6">
            {dirty ? <Button size="small" variant="secondary" onClick={() => setDirty(false)}>{t('common.cancel')}</Button> : null}
            <Button
              size="small"
              disabled={!dirty || saving}
              leadingIcon={saving ? SpinnerIcon : undefined}
              aria-busy={saving || undefined}
              onClick={submitSettings}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-body-semibold text-text-primary">{t('ssh.ipPool.assignmentsTitle')}</h4>
        <Button size="small" variant="secondary" leadingIcon={RiAddLine} disabled={!pool.supported} onClick={onAssign}>{t('ssh.ipPool.assign')}</Button>
      </div>
      {pool.assignments.length === 0 ? (
        <p className="text-caption-1-regular text-text-tertiary">{t('ssh.ipPool.assignmentsEmpty')}</p>
      ) : (
        <div className={GROUP}>
          {pool.assignments.map((assignment) => {
            const stateChip = STATE_CHIPS[assignment.state];
            const connected = assignment.state === 'connected' || assignment.state === 'connecting';
            const pending = busy[assignment.ip];
            const lastUsed = formatIsoTimestamp(assignment.lastUsedAt);
            return (
              <div key={assignment.ip} className={ROW}>
                <div className="flex min-w-0 items-center gap-3">
                  <RiRouterLine aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <bdi dir="ltr" className="truncate font-mono text-body-medium text-text-primary">{assignment.ip}</bdi>
                      <IconAction
                        icon={RiFileCopyLine}
                        size="xs"
                        aria-label={t('ssh.ipPool.copyIp', { ip: assignment.ip })}
                        tooltip
                        onClick={() => void copyText(assignment.ip, t('common.copied'), t('chat.copyFailed'))}
                      />
                      <Chip variant="caption" color={stateChip.color}>{t(stateChip.key)}</Chip>
                      <Chip variant="caption" color="neutral">
                        {assignment.portMode === 'auto' ? t('ssh.ipPool.modeAuto') : t('ssh.ipPool.modeManual')}
                      </Chip>
                    </div>
                    <p className="flex min-w-0 flex-wrap items-center gap-x-1 text-body-2-regular text-text-secondary">
                      <span className="truncate">{assignment.alias}</span>
                      <span aria-hidden>·</span>
                      <span>{t('ssh.ipPool.listening', { count: assignment.listeningPorts })}</span>
                      {assignment.skippedPortCount > 0 ? (
                        <>
                          <span aria-hidden>·</span>
                          <TooltipTrigger delay={200}>
                            <Focusable>
                              <span role="button" tabIndex={0} className="cursor-default rounded-md text-status-yellow-text outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                                {t('ssh.ipPool.skipped', { count: assignment.skippedPortCount })}
                              </span>
                            </Focusable>
                            <Tooltip className="max-w-sm break-words">
                              {t('ssh.ipPool.skippedHint')} <bdi dir="ltr" className="font-mono">{assignment.skippedPorts.join(', ')}{assignment.skippedPortCount > assignment.skippedPorts.length ? ', …' : ''}</bdi>
                            </Tooltip>
                          </TooltipTrigger>
                        </>
                      ) : null}
                      <span aria-hidden>·</span>
                      <span>{t('ssh.ipPool.activeConnections', { count: assignment.activeConnections })}</span>
                      {lastUsed ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{t('ssh.connections.lastUsed', { time: lastUsed })}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {connected ? (
                      <IconAction
                        icon={pending ? SpinnerIcon : RiLinkUnlink}
                        size="sm"
                        aria-label={t('ssh.ipPool.disconnect')}
                        tooltip
                        disabled={pending}
                        onClick={() => void disconnect(assignment)}
                      />
                    ) : (
                      <IconAction
                        icon={pending ? SpinnerIcon : RiLinkM}
                        size="sm"
                        aria-label={t('ssh.ipPool.connect')}
                        tooltip
                        disabled={pending || !pool.enabled}
                        onClick={() => void connect(assignment)}
                      />
                    )}
                    <IconAction icon={RiEdit2Line} size="sm" aria-label={t('ssh.ipPool.editPorts')} tooltip onClick={() => onEditAssignment(assignment)} />
                    <IconAction icon={RiDeleteBinLine} size="sm" aria-label={t('ssh.ipPool.remove')} tooltip onClick={() => onRemoveAssignment(assignment)} />
                  </div>
                </div>
                {assignment.failure || assignment.error ? (
                  <p className="break-words text-caption-1-regular text-text-error-primary">
                    {t(SSH_FAILURE_LABEL_KEYS[assignment.failure ?? 'other'])}
                    {assignment.error ? <span className="ms-1 font-mono opacity-80">{assignment.error}</span> : null}
                  </p>
                ) : null}
                {assignment.bindError ? (
                  <Alert
                    status="warning"
                    title={t('ssh.ipPool.bindError')}
                    description={(
                      <>
                        <span className="block break-words font-mono text-caption-1-regular opacity-80">{assignment.bindError.message}</span>
                        {assignment.bindError.kind === 'addressUnavailable' ? (
                          <>
                            <span className="mt-1 block">{t('ssh.ipPool.macAliasHint')}</span>
                            <div dir="ltr">
                              <CodeBlock code={`sudo ifconfig lo0 alias ${assignment.ip}`} language="bash" title="macOS" copyLabel={t('common.copy')} />
                            </div>
                          </>
                        ) : null}
                      </>
                    )}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiExternalLinkLine, RiRefreshLine } from '@remixicon/react';
import { Chip, type ChipProps } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import type { ContainerInfo, ContainerProgress, DockerEnvironment, DockerProblem } from '../../../preload/containerTypes';
import type { LocalAdminStatus } from '../../../preload/localBackendTypes';
import { useT } from '../../i18n';
import { backendBusy, connectContainer, containerProfiles } from '../../session/containerConnection';
import { useContainerPrefs } from '../../session/containerPrefs';
import { freezeContainer, wakeContainer } from '../../session/containerFreeze';
import type { TodeXSession } from '../../session/useTodeXSession';
import { CreateContainerDialog } from '../container/CreateContainerDialog';
import { ContainerLogsDialog } from '../container/ContainerLogsDialog';
import { ConfirmDialog } from '../ui/modal';
import { Spinner } from '../ui/spinner';
import { toast } from '../ui/toast';
import { InstanceAdmin } from './LocalBackendSettings';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow, SettingsValueField } from './SettingsRows';

const README_URL = 'https://github.com/youtonghy/TodeX_container#readme';
const DOCKER_INSTALL_URL = 'https://docs.docker.com/get-started/get-docker/';
const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';
const STOPPED_DAYS = [0, 1, 7, 30];
const FREEZE_MINUTES = [15, 30, 60, 120, 240];
const PHASE_LABELS = {
  pull: 'container.phase.pull',
  start: 'container.phase.start',
  wait: 'container.phase.wait',
  stop: 'container.phase.stop',
  remove: 'container.phase.remove',
} as const satisfies Record<ContainerProgress['phase'], string>;

type T = ReturnType<typeof useT>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function dockerProblemText(t: T, problem: DockerProblem): string {
  return t(problem === 'missing' ? 'container.env.missing' : problem === 'permission' ? 'container.env.permission' : 'container.env.daemonDown');
}

/** Why the shared local socket cannot be used, or null when it can. */
function socketUnavailableReason(t: T, environment: DockerEnvironment): string | null {
  if (window.todexDesktop.shell.platform !== 'linux') return t('container.env.socketDesktop');
  if (environment.rootless || environment.userns || environment.podman) return t('container.env.socketRemapped');
  return null;
}

function stateChip(t: T, item: ContainerInfo): { label: string; color: NonNullable<ChipProps['color']> } {
  if (item.state === 'running') {
    if (item.health === 'starting') return { label: t('container.state.starting'), color: 'blue' };
    if (item.health === 'unhealthy') return { label: t('container.state.unhealthy'), color: 'rose' };
    return { label: t('container.state.running'), color: 'lime' };
  }
  if (item.state === 'paused') return { label: t('container.state.frozen'), color: 'cyan' };
  if (item.state === 'removed') return { label: t('container.state.removed'), color: 'neutral' };
  if (item.state === 'restarting') return { label: t('container.state.starting'), color: 'blue' };
  return { label: t('container.state.stopped'), color: 'neutral' };
}

/**
 * Settings → TodeX Container: what it is, whether Docker is usable, the
 * TodeX containers on this machine (todexc instances, which Desktop manages
 * fully, and plain compose ones), and automatic cleanup.
 */
export function ContainerSettings({ session, deviceName }: { session: TodeXSession; deviceName: string }) {
  const t = useT();
  const api = window.todexDesktop.container;
  const [environment, setEnvironment] = useState<DockerEnvironment | null>(null);
  const [items, setItems] = useState<ContainerInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ContainerInfo | null>(null);
  const [deleteVolume, setDeleteVolume] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; label: string; run: () => void } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [prefs, updatePrefs] = useContainerPrefs();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const refresh = useCallback(async (redetect = false) => {
    try {
      const env = await api.environment(redetect);
      setEnvironment(env);
      setItems(env.problem ? [] : await api.list());
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [api]);

  useEffect(() => {
    void refresh(true);
    return api.onProgress((event) => setProgress((current) => ({ ...current, [event.name]: event.line ?? t(PHASE_LABELS[event.phase]) })));
  }, [api, refresh]);

  const run = async (item: ContainerInfo, action: string, task: () => Promise<unknown>) => {
    setBusy((current) => ({ ...current, [item.name]: action }));
    setItemErrors((current) => ({ ...current, [item.name]: '' }));
    try {
      await task();
    } catch (cause) {
      setItemErrors((current) => ({ ...current, [item.name]: errorText(cause) }));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[item.name];
        return next;
      });
      setProgress((current) => ({ ...current, [item.name]: '' }));
      await refresh();
    }
  };

  /** Recreating a running container interrupts its turns: confirm when one runs. */
  const guardRecreate = (item: ContainerInfo, action: () => void) => {
    const profiles = containerProfiles(sessionRef.current.backendConnections, item).map((profile) => profile.id);
    if (item.state === 'running' && backendBusy(sessionRef.current, profiles)) {
      setConfirm({ title: t('container.recreateTitle'), body: t('container.recreateBusy'), label: t('container.recreateConfirm'), run: action });
    } else {
      action();
    }
  };

  const addMount = async (item: ContainerInfo) => {
    const path = await window.todexDesktop.dialog.openDirectory();
    if (!path) return;
    guardRecreate(item, () => void run(item, 'mount', () => api.addMount(item.name, path)));
  };

  const removeMount = (item: ContainerInfo, host: string) => guardRecreate(item, () => void run(item, 'mount', () => (
    api.setMounts(item.name, item.mounts.filter((mount) => mount.host !== host).map((mount) => mount.host))
  )));

  const cleanupNow = async () => {
    setCleaning(true);
    try {
      const result = await api.cleanup();
      toast.success(t('container.cleanup.result', { images: result.images, containers: result.containers }));
    } catch (cause) {
      toast.danger(errorText(cause));
    } finally {
      setCleaning(false);
      await refresh();
    }
  };

  const ready = Boolean(environment && !environment.problem && environment.composeVersion);
  const socketReason = environment ? socketUnavailableReason(t, environment) : null;

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup label={t('container.intro.title')}>
        <SettingsCard>
          <SettingsNote>
            <div className="flex flex-col gap-2">
              <span>{t('container.intro.body')}</span>
              <span>{t('container.intro.isolation')}</span>
              <span>{t('container.intro.data')}</span>
            </div>
          </SettingsNote>
          <SettingsRow label={t('container.intro.docs')}>
            <Button size="small" variant="secondary" trailingIcon={RiExternalLinkLine} onClick={() => window.open(README_URL, '_blank', 'noopener')}>{t('container.intro.openDocs')}</Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup
        label={t('container.env.title')}
        action={<Button size="small" variant="secondary" leadingIcon={RiRefreshLine} onClick={() => { setEnvironment(null); void refresh(true); }}>{t('container.env.recheck')}</Button>}
      >
        <SettingsCard>
          {!environment ? (
            <SettingsNote><div className="flex justify-center py-2"><Spinner aria-label={t('container.env.checking')} /></div></SettingsNote>
          ) : (
            <>
              <SettingsRow label={t('container.env.cli')}>
                {environment.clientVersion ? <SettingsValueField mono className="w-auto">{environment.clientVersion}</SettingsValueField> : (
                  <Button size="small" variant="secondary" trailingIcon={RiExternalLinkLine} onClick={() => window.open(DOCKER_INSTALL_URL, '_blank', 'noopener')}>{t('container.env.install')}</Button>
                )}
              </SettingsRow>
              <SettingsRow label={t('container.env.daemon')} description={environment.operatingSystem ?? undefined}>
                {environment.problem
                  ? <Chip variant="caption" color="rose">{t('container.env.unavailable')}</Chip>
                  : <SettingsValueField mono className="w-auto">{environment.serverVersion ?? '-'}</SettingsValueField>}
              </SettingsRow>
              <SettingsRow label={t('container.env.compose')}>
                {environment.composeVersion
                  ? <SettingsValueField mono className="w-auto">{environment.composeVersion}</SettingsValueField>
                  : <Chip variant="caption" color="rose">{t('container.env.unavailable')}</Chip>}
              </SettingsRow>
              {!environment.problem ? (
                <>
                  <SettingsRow label={t('container.env.socket')} description={socketReason ?? t('container.env.socketOk')}>
                    <Chip variant="caption" color={socketReason ? 'neutral' : 'lime'}>{socketReason ? t('container.env.socketTcp') : t('container.env.socketIpc')}</Chip>
                  </SettingsRow>
                  <SettingsRow label={t('container.env.image')} description={environment.imageTags.length ? undefined : t('container.env.imageMissing')}>
                    <SettingsValueField mono className="w-auto">{environment.imageTags.length ? environment.imageTags.join(', ') : '-'}</SettingsValueField>
                  </SettingsRow>
                </>
              ) : null}
              {environment.problem ? (
                <SettingsNote tone="warning">
                  <div className="flex flex-col gap-1">
                    <span>{dockerProblemText(t, environment.problem)}</span>
                    {environment.problemDetail ? <span className="font-mono text-caption-1-regular whitespace-pre-wrap">{environment.problemDetail}</span> : null}
                  </div>
                </SettingsNote>
              ) : !environment.composeVersion ? <SettingsNote tone="warning">{t('container.env.composeMissing')}</SettingsNote> : null}
            </>
          )}
          {error ? <SettingsNote tone="danger" role="alert">{error}</SettingsNote> : null}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup
        label={t('container.list.title')}
        description={t('container.list.hint')}
        action={<Button size="small" leadingIcon={RiAddLine} disabled={!ready} onClick={() => setCreateOpen(true)}>{t('container.list.create')}</Button>}
      >
        {ready && !items.length ? <SettingsCard><SettingsNote>{t('container.list.empty')}</SettingsNote></SettingsCard> : null}
        {items.map((item) => (
          <ContainerCard
            key={item.name}
            session={session}
            deviceName={deviceName}
            item={item}
            busy={busy[item.name] ?? null}
            progress={progress[item.name] ?? ''}
            error={itemErrors[item.name] ?? ''}
            onConnect={() => void run(item, 'connect', () => connectContainer(sessionRef.current, item, deviceName))}
            onStart={() => void run(item, 'start', () => api.start(item.name))}
            onStop={() => void run(item, 'stop', () => api.stop(item.name))}
            onRestart={() => void run(item, 'restart', () => api.restart(item.name))}
            onUpgrade={() => guardRecreate(item, () => void run(item, 'upgrade', () => api.upgrade(item.name)))}
            onLogs={() => setLogsFor(item.name)}
            onRemove={() => { setDeleteVolume(false); setRemoving(item); }}
            onAddMount={() => void addMount(item)}
            onRemoveMount={(host) => removeMount(item, host)}
            onFreeze={() => void run(item, 'freeze', () => freezeContainer(sessionRef.current, item))}
            onWake={() => void run(item, 'wake', () => wakeContainer(() => sessionRef.current, item))}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup label={t('container.freeze.title')} description={t('container.freeze.hint')}>
        <SettingsCard>
          <SettingsRow label={t('container.freeze.enabled')} description={t('container.freeze.enabledHint')}>
            <Switch
              size="sm"
              aria-label={t('container.freeze.enabled')}
              isSelected={(prefs.freezeIdleMinutes ?? 0) > 0}
              onChange={(on) => updatePrefs({ freezeIdleMinutes: on ? 30 : 0 })}
            />
          </SettingsRow>
          {(prefs.freezeIdleMinutes ?? 0) > 0 ? (
            <SettingsRow label={t('container.freeze.idle')} description={t('container.freeze.idleHint')}>
              <Select
                aria-label={t('container.freeze.idle')}
                triggerClassName={ROW_SELECT_TRIGGER}
                selectedKey={String(prefs.freezeIdleMinutes)}
                onSelectionChange={(key) => key !== null && updatePrefs({ freezeIdleMinutes: Number(key) })}
              >
                {[...new Set([...FREEZE_MINUTES, prefs.freezeIdleMinutes ?? 30])].sort((a, b) => a - b).map((minutes) => (
                  <SelectItem key={minutes} id={String(minutes)} textValue={String(minutes)}>
                    {minutes < 60 ? t('container.freeze.minutes', { count: minutes }) : t('container.freeze.hours', { count: minutes / 60 })}
                  </SelectItem>
                ))}
              </Select>
            </SettingsRow>
          ) : null}
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup label={t('container.cleanup.title')} description={t('container.cleanup.hint')}>
        <SettingsCard>
          <SettingsRow label={t('container.cleanup.images')} description={t('container.cleanup.imagesHint')}>
            <Switch size="sm" aria-label={t('container.cleanup.images')} isSelected={prefs.cleanupImages !== false} onChange={(cleanupImages) => updatePrefs({ cleanupImages })} />
          </SettingsRow>
          <SettingsRow label={t('container.cleanup.stopped')} description={t('container.cleanup.stoppedHint')}>
            <Select
              aria-label={t('container.cleanup.stopped')}
              triggerClassName={ROW_SELECT_TRIGGER}
              selectedKey={String(STOPPED_DAYS.includes(prefs.removeStoppedDays ?? 0) ? prefs.removeStoppedDays ?? 0 : 0)}
              onSelectionChange={(key) => key !== null && updatePrefs({ removeStoppedDays: Number(key) })}
            >
              {STOPPED_DAYS.map((days) => (
                <SelectItem key={days} id={String(days)} textValue={String(days)}>{days ? t('container.cleanup.days', { count: days }) : t('container.cleanup.never')}</SelectItem>
              ))}
            </Select>
          </SettingsRow>
          <SettingsRow label={t('container.cleanup.mounts')} description={t('container.cleanup.mountsHint')}>
            <Switch size="sm" aria-label={t('container.cleanup.mounts')} isSelected={prefs.pruneMounts === true} onChange={(pruneMounts) => updatePrefs({ pruneMounts })} />
          </SettingsRow>
          <SettingsRow label={t('container.cleanup.stopOnQuit')} description={t('container.cleanup.stopOnQuitHint')}>
            <Switch size="sm" aria-label={t('container.cleanup.stopOnQuit')} isSelected={prefs.stopOnQuit === true} onChange={(stopOnQuit) => updatePrefs({ stopOnQuit })} />
          </SettingsRow>
          <SettingsRow label={t('container.cleanup.now')} description={t('container.cleanup.nowHint')}>
            <Button size="small" variant="secondary" disabled={!ready || cleaning} onClick={() => void cleanupNow()}>{cleaning ? t('container.cleanup.running') : t('container.cleanup.run')}</Button>
          </SettingsRow>
        </SettingsCard>
      </SettingsGroup>

      <CreateContainerDialog isOpen={createOpen} onOpenChange={setCreateOpen} onCreated={() => void refresh()} />
      <ContainerLogsDialog name={logsFor} onClose={() => setLogsFor(null)} />
      <ConfirmDialog
        isOpen={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('container.remove.title', { name: removing?.name ?? '' })}
        description={t('container.remove.body', { volume: `todex-${removing?.name ?? ''}-home` })}
        confirmLabel={t('container.remove.confirm')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          const item = removing;
          setRemoving(null);
          if (item) void run(item, 'remove', () => api.remove(item.name, deleteVolume));
        }}
      >
        <Checkbox isSelected={deleteVolume} onChange={setDeleteVolume}>{t('container.remove.deleteVolume')}</Checkbox>
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.title ?? ''}
        description={confirm?.body}
        confirmLabel={confirm?.label ?? ''}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          const action = confirm?.run;
          setConfirm(null);
          action?.();
        }}
      />
    </div>
  );
}

function ContainerCard({ session, deviceName, item, busy, progress, error, onConnect, onStart, onStop, onRestart, onUpgrade, onLogs, onRemove, onAddMount, onRemoveMount, onFreeze, onWake }: {
  session: TodeXSession;
  deviceName: string;
  item: ContainerInfo;
  busy: string | null;
  progress: string;
  error: string;
  onConnect: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onUpgrade: () => void;
  onLogs: () => void;
  onRemove: () => void;
  onAddMount: () => void;
  onRemoveMount: (host: string) => void;
  onFreeze: () => void;
  onWake: () => void;
}) {
  const t = useT();
  const [adminOpen, setAdminOpen] = useState(false);
  const [admin, setAdmin] = useState<{ status: LocalAdminStatus | null; error: string }>({ status: null, error: '' });
  const profiles = containerProfiles(session.backendConnections, item);
  const connected = profiles.some((profile) => session.backendLinkStatus[profile.id]?.state === 'open');
  const running = item.state === 'running';
  const paused = item.state === 'paused';
  const chip = stateChip(t, item);
  const disabled = busy !== null;

  useEffect(() => {
    if (!adminOpen || !item.ipcInstance) return;
    let cancelled = false;
    window.todexDesktop.localBackend.status(item.ipcInstance).then(
      (status) => !cancelled && setAdmin({ status, error: '' }),
      (cause) => !cancelled && setAdmin({ status: null, error: errorText(cause) }),
    );
    return () => { cancelled = true; };
  }, [adminOpen, item.ipcInstance]);

  return (
    <div className="flex flex-col gap-3">
      <SettingsCard>
        <SettingsRow
          label={item.name}
          description={[item.image, item.port ? `${item.listen ?? '127.0.0.1'}:${item.port}` : null].filter(Boolean).join(' · ')}
        >
          {busy ? <Spinner aria-label={t('container.working')} /> : null}
          <Chip variant="caption" color={chip.color}>{chip.label}</Chip>
          {connected ? <Chip variant="caption" color="lime">{t('localBackend.state.connected')}</Chip> : null}
        </SettingsRow>
        {item.mounts.map((mount) => (
          <SettingsRow
            key={mount.host}
            label={<span className="font-mono text-body-2-regular">{mount.host}</span>}
            description={mount.target !== mount.host ? t('container.mountTarget', { target: mount.target }) : t('container.mountSamePath')}
          >
            {item.managed && item.mounts.length > 1 ? (
              <Button size="small" variant="secondary" iconOnly leadingIcon={RiDeleteBinLine} aria-label={t('container.mountRemove')} disabled={disabled} onClick={() => onRemoveMount(mount.host)} />
            ) : null}
          </SettingsRow>
        ))}
        {!item.managed ? <SettingsNote>{t('container.unmanaged')}</SettingsNote> : null}
        {item.state === 'removed' ? <SettingsNote>{t('container.removedHint')}</SettingsNote> : null}
        {busy && progress ? <SettingsNote><span className="block truncate font-mono text-caption-1-regular">{progress}</span></SettingsNote> : null}
        {error ? <SettingsNote tone="danger" role="alert"><span className="whitespace-pre-wrap">{error}</span></SettingsNote> : null}
      </SettingsCard>
      <div className="flex flex-wrap gap-2 px-3">
        {running && !connected ? <Button size="small" disabled={disabled} onClick={onConnect}>{t('localBackend.connect')}</Button> : null}
        {paused ? <Button size="small" disabled={disabled} onClick={onWake}>{t('container.freeze.wake')}</Button> : null}
        {!running && !paused ? <Button size="small" disabled={disabled} onClick={onStart}>{t('container.start')}</Button> : null}
        {running ? <Button size="small" variant="secondary" disabled={disabled} onClick={onFreeze}>{t('container.freeze.freeze')}</Button> : null}
        {running ? <Button size="small" variant="secondary" disabled={disabled} onClick={onStop}>{t('container.stop')}</Button> : null}
        {running ? <Button size="small" variant="secondary" disabled={disabled} onClick={onRestart}>{t('container.restart')}</Button> : null}
        {item.managed ? <Button size="small" variant="secondary" disabled={disabled} onClick={onAddMount}>{t('container.mountAdd')}</Button> : null}
        {item.managed ? <Button size="small" variant="secondary" disabled={disabled} onClick={onUpgrade}>{t('container.upgrade')}</Button> : null}
        {item.container ? <Button size="small" variant="secondary" onClick={onLogs}>{t('container.logs')}</Button> : null}
        {item.ipcInstance ? <Button size="small" variant="secondary" onClick={() => setAdminOpen((open) => !open)}>{adminOpen ? t('container.adminHide') : t('container.adminShow')}</Button> : null}
        {item.managed ? <Button size="small" variant="danger" disabled={disabled} onClick={onRemove}>{t('container.remove.action')}</Button> : null}
      </div>
      {adminOpen && admin.error ? <SettingsCard><SettingsNote tone="warning">{t('localBackend.containerSocketRefused', { error: admin.error })}</SettingsNote></SettingsCard> : null}
      {adminOpen && admin.status && item.ipcInstance ? (
        <InstanceAdmin
          instance={item.ipcInstance}
          status={admin.status}
          ipcConnected={connected}
          canRestart={false}
          onRepair={() => connectContainer(session, item, deviceName, { repair: true })}
        />
      ) : null}
    </div>
  );
}

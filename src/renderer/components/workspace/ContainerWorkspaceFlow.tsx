import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RiCheckLine, RiCloseLine, RiFolderOpenLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Select, SelectItem } from '@/components/base/select/select';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ui/modal';
import { cx } from '@/utils/cx';
import { mapHostPathToBackend } from '@todex/protocol/pathMapping';
import type { CliUpgradeOperation, CliVersionInfo, ManagedCliProvider } from '@todex/protocol/v2';
import type { ContainerInfo, DockerEnvironment } from '../../../preload/containerTypes';
import { useT } from '../../i18n';
import { backendApi, fetchWorkspaceDirectorySnapshot } from '../../session/helpers';
import { backendBusy, connectContainer, containerProfiles, waitForLink } from '../../session/containerConnection';
import { useConfigSync } from '../../session/useConfigSync';
import { CONFIG_SYNC_CATEGORIES } from '@todex/protocol/configSync';
import type { TodeXSession } from '../../session/useTodeXSession';
import { AGENT_CONFIG_CATEGORIES, agentConfigSource } from '../settings/BackendConnectionSettings';
import { SettingsCard, SettingsNote, SettingsRow, SettingsValueField } from '../settings/SettingsRows';
import { dockerProblemText } from '../settings/ContainerSettings';

const NEW_CONTAINER = '__new__';
/** Offered pre-ticked when the container does not have it yet. */
const DEFAULT_AGENTS: ManagedCliProvider[] = ['claude-code'];

type Step = 'setup' | 'prepare' | 'agents' | 'sync';
type PrepareStage = 'container' | 'connect' | 'workspace';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function basename(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
}

const windows = () => window.todexDesktop.shell.platform === 'win32';

/** The container path of `hostPath` when one of `container`'s mounts covers it. */
function containerPathOf(container: ContainerInfo, hostPath: string): string | null {
  return mapHostPathToBackend(hostPath, container.mounts.map((mount) => ({ hostPath: mount.host, backendPath: mount.target })), { windows: windows() });
}

/**
 * New workspace → Container workspace: pick a host folder and a TodeX
 * container (or a new one), mount the folder, connect to the container's
 * backend (pairing on the way), create the workspace at the folder's
 * container path, then offer agent installs and config sync. Returns the
 * dialog's body and footer; CreateWorkspaceModal renders them.
 */
export function useContainerWorkspaceFlow({ session, enabled, name, setName, deviceName, onDone, onOpenSettings }: {
  session: TodeXSession;
  enabled: boolean;
  name: string;
  setName: (name: string) => void;
  deviceName: string;
  onDone: () => void;
  onOpenSettings: () => void;
}): { body: ReactNode; footer: ReactNode } {
  const t = useT();
  const api = window.todexDesktop.container;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [step, setStep] = useState<Step>('setup');
  const [environment, setEnvironment] = useState<DockerEnvironment | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loadError, setLoadError] = useState('');
  const [folder, setFolder] = useState('');
  const [target, setTarget] = useState<string>(NEW_CONTAINER);
  const [stage, setStage] = useState<PrepareStage | null>(null);
  const [progressLine, setProgressLine] = useState('');
  const [error, setError] = useState('');
  const [confirmRecreate, setConfirmRecreate] = useState(false);
  const [profileId, setProfileId] = useState('');
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setLoadError('');
    try {
      const env = await api.environment(refresh);
      setEnvironment(env);
      const list = env.problem ? [] : await api.list();
      setContainers(list);
      setTarget((current) => {
        if (current !== NEW_CONTAINER && list.some((item) => item.name === current)) return current;
        const managed = list.filter((item) => item.managed);
        return managed.length === 1 ? managed[0].name : NEW_CONTAINER;
      });
    } catch (cause) {
      setLoadError(errorText(cause));
    }
  }, [api]);

  useEffect(() => {
    if (enabled && !environment) void load(true);
  }, [enabled, environment, load]);
  useEffect(() => api.onProgress((progress) => setProgressLine(progress.line ?? '')), [api]);
  useEffect(() => () => abort.current?.abort(), []);

  // Unmanaged containers (plain compose) cannot be remounted: only offered when they already see the folder.
  const choices = containers.filter((item) => item.managed || (folder && containerPathOf(item, folder)));
  const chosen = containers.find((item) => item.name === target) ?? null;
  const dockerReady = Boolean(environment && !environment.problem && environment.composeVersion);

  const pickFolder = async () => {
    const selected = await window.todexDesktop.dialog.openDirectory();
    if (!selected) return;
    setFolder(selected);
    if (!name.trim()) setName(basename(selected));
  };

  /** Mount, start, connect, create the workspace. */
  const prepare = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStep('prepare');
    setError('');
    setProgressLine('');
    try {
      setStage('container');
      let container: ContainerInfo;
      let backendPath: string | null = null;
      if (!chosen) {
        container = await api.create({ mounts: [folder] });
      } else if (chosen.managed) {
        const result = await api.addMount(chosen.name, folder);
        backendPath = result.backendPath;
        container = (await api.list()).find((item) => item.name === chosen.name) ?? chosen;
      } else {
        if (chosen.state !== 'running') await api.start(chosen.name);
        container = (await api.list()).find((item) => item.name === chosen.name) ?? chosen;
      }
      backendPath ??= containerPathOf(container, folder);
      if (!backendPath) throw new Error(t('container.folderNotMounted', { path: folder }));
      setStage('connect');
      const id = await connectContainer(sessionRef.current, container, deviceName, { signal: controller.signal });
      await waitForLink(() => sessionRef.current, id, 30_000, controller.signal);
      setStage('workspace');
      // The backend confirms it sees the folder at that path.
      const snapshot = await fetchWorkspaceDirectorySnapshot(sessionRef.current.settingsForBackend(id), backendPath);
      sessionRef.current.createWorkspace(name.trim() || basename(folder), snapshot.current, id);
      setProfileId(id);
      setStage(null);
      setStep('agents');
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(errorText(cause));
    } finally {
      void load(false);
    }
  };

  /** Adding a mount recreates a running container: confirm when a turn runs there. */
  const start = () => {
    if (chosen?.managed && chosen.state === 'running' && !containerPathOf(chosen, folder)) {
      const profiles = containerProfiles(session.backendConnections, chosen).map((profile) => profile.id);
      if (backendBusy(session, profiles)) {
        setConfirmRecreate(true);
        return;
      }
    }
    void prepare();
  };

  const cancel = () => {
    abort.current?.abort();
    onDone();
  };

  const finishAgents = () => {
    const source = agentConfigSource(sessionRef.current, profileId);
    if (source && sessionRef.current.backendLinkStatus[source.id]?.state === 'open') setStep('sync');
    else onDone();
  };

  const agents = useAgentInstallStep({ session, profileId: step === 'agents' ? profileId : '', onFinish: finishAgents });
  const sync = useSyncStep({ session, profileId, active: step === 'sync', onFinish: onDone });

  if (!enabled) return { body: null, footer: null };
  if (step === 'agents') return agents;
  if (step === 'sync') return sync;

  if (step === 'prepare') {
    const stages: Array<{ id: PrepareStage; label: string }> = [
      { id: 'container', label: chosen ? t('container.flow.stageMount') : t('container.flow.stageCreate') },
      { id: 'connect', label: t('container.flow.stageConnect') },
      { id: 'workspace', label: t('container.flow.stageWorkspace') },
    ];
    const reached = stage ? stages.findIndex((item) => item.id === stage) : stages.length;
    return {
      body: (
        <div className="flex flex-col gap-3">
          <SettingsCard>
            {stages.map((item, index) => (
              <SettingsRow key={item.id} label={item.label}>
                {index < reached ? <RiCheckLine className="size-4 text-foreground-icon-secondary" aria-label={t('container.flow.stageDone')} />
                  : index === reached && !error ? <Spinner aria-label={item.label} />
                    : index === reached && error ? <RiCloseLine className="size-4 text-text-error-primary" aria-label={t('container.flow.stageFailed')} /> : null}
              </SettingsRow>
            ))}
            {progressLine && !error ? <SettingsNote><span className="block truncate font-mono text-caption-1-regular">{progressLine}</span></SettingsNote> : null}
            {stage === 'container' && !error && !chosen ? <SettingsNote>{t('container.flow.firstPullHint')}</SettingsNote> : null}
            {error ? <SettingsNote tone="danger" role="alert"><span className="whitespace-pre-wrap">{error}</span></SettingsNote> : null}
          </SettingsCard>
        </div>
      ),
      footer: (
        <>
          <Button variant="secondary" onClick={cancel}>{t('common.cancel')}</Button>
          {error ? <Button variant="secondary" onClick={() => { setStep('setup'); setError(''); }}>{t('container.flow.back')}</Button> : null}
          {error ? <Button onClick={() => void prepare()}>{t('container.flow.retry')}</Button> : null}
        </>
      ),
    };
  }

  return {
    body: (
      <div className="flex flex-col gap-4">
        {loadError ? <SettingsNote tone="danger" role="alert">{loadError}</SettingsNote> : null}
        {!environment && !loadError ? <div className="flex justify-center py-4"><Spinner aria-label={t('container.env.checking')} /></div> : null}
        {environment && !dockerReady ? (
          <SettingsNote tone="warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{environment.problem ? dockerProblemText(t, environment.problem) : t('container.env.composeMissing')}</span>
              <span className="flex gap-2">
                <Button size="small" variant="secondary" onClick={() => void load(true)}>{t('container.env.recheck')}</Button>
                <Button size="small" variant="secondary" onClick={onOpenSettings}>{t('container.flow.openSettings')}</Button>
              </span>
            </div>
          </SettingsNote>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-body-2-medium text-text-primary">{t('container.flow.folder')}</span>
          <div className="flex items-center gap-2">
            <SettingsValueField mono muted={!folder} title={folder} className="min-w-0 flex-1">{folder || t('container.flow.folderNone')}</SettingsValueField>
            <Button variant="secondary" leadingIcon={RiFolderOpenLine} onClick={() => void pickFolder()}>{t('container.flow.pickFolder')}</Button>
          </div>
          <span className="text-body-2-regular text-text-tertiary">{t('container.flow.folderHint')}</span>
        </div>
        <Select
          label={t('container.flow.container')}
          className="w-full"
          popoverClassName="w-(--trigger-width)"
          isDisabled={!dockerReady}
          selectedKey={choices.some((item) => item.name === target) ? target : NEW_CONTAINER}
          onSelectionChange={(key) => typeof key === 'string' && setTarget(key)}
        >
          {[
            ...choices.map((item) => (
              <SelectItem key={item.name} id={item.name} textValue={item.name}>
                {item.name} · {t(item.state === 'running' ? 'container.state.running' : 'container.state.stopped')}{item.port ? ` · 127.0.0.1:${item.port}` : ''}
              </SelectItem>
            )),
            <SelectItem key={NEW_CONTAINER} id={NEW_CONTAINER} textValue={t('container.flow.newContainer')}>{t('container.flow.newContainer')}</SelectItem>,
          ]}
        </Select>
        {folder && chosen ? (
          <span className={cx('text-body-2-regular', containerPathOf(chosen, folder) ? 'text-text-tertiary' : 'text-text-secondary')}>
            {containerPathOf(chosen, folder)
              ? t('container.flow.alreadyMounted', { path: containerPathOf(chosen, folder) ?? '' })
              : chosen.state === 'running' ? t('container.flow.willRecreate') : t('container.flow.willMount')}
          </span>
        ) : folder ? <span className="text-body-2-regular text-text-tertiary">{t('container.flow.willCreate')}</span> : null}
        <ConfirmDialog
          isOpen={confirmRecreate}
          onOpenChange={setConfirmRecreate}
          title={t('container.recreateTitle')}
          description={t('container.recreateBusy')}
          confirmLabel={t('container.recreateConfirm')}
          cancelLabel={t('common.cancel')}
          tone="danger"
          onConfirm={() => {
            setConfirmRecreate(false);
            void prepare();
          }}
        />
      </div>
    ),
    footer: (
      <>
        <Button variant="secondary" onClick={cancel}>{t('common.cancel')}</Button>
        <Button disabled={!dockerReady || !folder} onClick={start}>{t('container.flow.next')}</Button>
      </>
    ),
  };
}

type AgentRow = { cli: CliVersionInfo; operation?: CliUpgradeOperation; startError?: string };

/** Lists the container's CLIs once `profileId` is set; installs the ticked ones over the backend API. */
function useAgentInstallStep({ session, profileId, onFinish }: { session: TodeXSession; profileId: string; onFinish: () => void }): { body: ReactNode; footer: ReactNode } {
  const t = useT();
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(false);
  const settings = session.settingsForBackend(profileId);
  const api = useMemo(() => backendApi(settings), [settings.serverUrl, settings.deviceSecret, settings.encryptionPublicKey, settings.transportVerified]);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setRows(null);
    setError('');
    void api.listCliVersions().then((response) => {
      if (cancelled) return;
      const managed = response.clis.filter((cli) => cli.kind === 'managed');
      setRows(managed.map((cli) => ({ cli })));
      setSelected(new Set(managed.filter((cli) => !cli.installed && cli.installSupported && DEFAULT_AGENTS.includes(cli.id as ManagedCliProvider)).map((cli) => cli.id)));
    }, (cause) => !cancelled && setError(errorText(cause)));
    return () => { cancelled = true; };
  }, [api, profileId]);

  const install = async () => {
    if (!rows) return;
    setInstalling(true);
    const ids = rows.filter((row) => selected.has(row.cli.id)).map((row) => row.cli.id as ManagedCliProvider);
    await Promise.all(ids.map(async (provider) => {
      const update = (patch: Partial<AgentRow>) => setRows((current) => current?.map((row) => (row.cli.id === provider ? { ...row, ...patch } : row)) ?? null);
      try {
        let operation = await api.installCli(provider);
        update({ operation });
        while (operation.status === 'running') {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          operation = await api.getCliUpgrade(operation.id);
          update({ operation });
        }
      } catch (cause) {
        update({ startError: errorText(cause) });
      }
    }));
    setInstalling(false);
    setSelected(new Set());
    const fresh = await api.listCliVersions().catch(() => null);
    if (fresh) setRows((current) => current?.map((row) => ({ ...row, cli: fresh.clis.find((cli) => cli.id === row.cli.id) ?? row.cli })) ?? null);
  };

  const attempted = rows?.some((row) => row.operation || row.startError) ?? false;
  return {
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-body-regular text-text-secondary">{t('container.agents.hint')}</p>
        {error ? <SettingsNote tone="danger" role="alert">{error}</SettingsNote> : null}
        {!rows && !error ? <div className="flex justify-center py-4"><Spinner aria-label={t('container.agents.loading')} /></div> : null}
        {rows ? (
          <SettingsCard>
            {rows.map(({ cli, operation, startError }) => {
              const canInstall = !cli.installed && cli.installSupported === true;
              const failed = startError ?? (operation?.status === 'failed' ? operation.error || t('cli.installFailed') : '');
              return (
                <SettingsRow key={cli.id} label={cli.name} description={failed || cli.currentVersion}>
                  {operation?.status === 'running' ? <Spinner aria-label={t('container.agents.installing')} />
                    : cli.managedBy === 'image' ? <Chip variant="caption" color="neutral">{t('cli.statusImageManaged')}</Chip>
                      : cli.installed ? <Chip variant="caption" color="lime">{t('container.agents.installed')}</Chip>
                        : failed ? <Chip variant="caption" color="rose">{t('container.agents.failed')}</Chip> : null}
                  {canInstall && operation?.status !== 'running' ? (
                    <Checkbox
                      aria-label={cli.name}
                      isDisabled={installing}
                      isSelected={selected.has(cli.id)}
                      onChange={(on) => setSelected((current) => {
                        const next = new Set(current);
                        if (on) next.add(cli.id); else next.delete(cli.id);
                        return next;
                      })}
                    />
                  ) : null}
                </SettingsRow>
              );
            })}
          </SettingsCard>
        ) : null}
      </div>
    ),
    footer: (
      <>
        <Button variant="secondary" disabled={installing} onClick={onFinish}>{attempted ? t('container.flow.continue') : t('container.flow.skip')}</Button>
        <Button disabled={installing || !selected.size} onClick={() => void install()}>{installing ? t('container.agents.installing') : t('container.agents.install')}</Button>
      </>
    ),
  };
}

/** Copies agent config (accounts, settings, MCP, skills) from another backend with the existing sync engine. */
function useSyncStep({ session, profileId, active, onFinish }: { session: TodeXSession; profileId: string; active: boolean; onFinish: () => void }): { body: ReactNode; footer: ReactNode } {
  const t = useT();
  const sync = useConfigSync(session);
  const [requested, setRequested] = useState(false);
  // Entering the step points the engine at this container with the agent categories.
  useEffect(() => {
    if (!active || !profileId) return;
    const source = agentConfigSource(session, profileId);
    if (source) sync.setSourceId(source.id);
    for (const id of sync.targetIds) if (id !== profileId) sync.toggleTarget(id, false);
    sync.toggleTarget(profileId, true);
    for (const category of CONFIG_SYNC_CATEGORIES) sync.toggleCategory(category, AGENT_CONFIG_CATEGORIES.includes(category));
  }, [active, profileId]);
  // Check, then write every entry the plan selects by default.
  useEffect(() => {
    if (!requested) return;
    if (sync.phase === 'ready') {
      setRequested(false);
      void sync.apply();
    } else if (sync.phase === 'idle' && sync.failure) {
      setRequested(false);
    }
  }, [requested, sync.phase, sync.failure]);

  const sources = session.backendConnections.filter((item) => item.id !== profileId && item.deviceSecret && session.backendLinkStatus[item.id]?.state === 'open');
  const results = sync.plans.flatMap((plan) => [...plan.results.values()]);
  const failed = results.filter((result) => !result.ok);
  const busy = sync.phase === 'checking' || sync.phase === 'applying' || requested;
  const done = sync.phase === 'done';
  return {
    body: (
      <div className="flex flex-col gap-3">
        <p className="text-body-regular text-text-secondary">{t('container.sync.hint')}</p>
        <Select
          label={t('container.sync.source')}
          className="w-full"
          popoverClassName="w-(--trigger-width)"
          isDisabled={busy || done}
          selectedKey={sources.some((item) => item.id === sync.sourceId) ? sync.sourceId : null}
          onSelectionChange={(key) => typeof key === 'string' && sync.setSourceId(key)}
        >
          {sources.map((item) => <SelectItem key={item.id} id={item.id} textValue={item.name}>{item.name} · {item.serverUrl}</SelectItem>)}
        </Select>
        {sync.progress ? <SettingsNote>{t('container.sync.progress', { done: sync.progress.done, total: sync.progress.total })}</SettingsNote> : null}
        {sync.failure ? <SettingsNote tone="danger" role="alert">{sync.failure}</SettingsNote> : null}
        {sync.sourceErrors.length ? <SettingsNote tone="warning">{sync.sourceErrors.map((item) => item.message).join('\n')}</SettingsNote> : null}
        {done ? (
          <SettingsNote tone={failed.length ? 'warning' : 'muted'}>
            {failed.length
              ? t('container.sync.partial', { ok: results.length - failed.length, failed: failed.length })
              : results.length ? t('container.sync.done', { count: results.length }) : t('container.sync.nothing')}
          </SettingsNote>
        ) : null}
      </div>
    ),
    footer: (
      <>
        <Button variant="secondary" disabled={busy} onClick={onFinish}>{done ? t('container.flow.finish') : t('container.flow.skip')}</Button>
        {!done ? (
          <Button disabled={busy || !sources.some((item) => item.id === sync.sourceId)} onClick={() => { setRequested(true); void sync.check(); }}>
            {busy ? t('container.sync.running') : t('container.sync.start')}
          </Button>
        ) : null}
      </>
    ),
  };
}


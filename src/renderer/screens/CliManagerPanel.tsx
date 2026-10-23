import { useCallback, useEffect, useRef, useState } from 'react';
import { RiArrowDownSLine, RiDeleteBin6Line, RiDownload2Line, RiDownloadCloud2Line, RiFileList3Line, RiPuzzle2Line, RiRefreshLine, RiServerLine, RiSettings3Line, RiTerminalBoxLine } from '@remixicon/react';
import { Chip, type ChipProps } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Divider } from '@/components/base/divider/divider';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { Spinner, SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import {
  type CliOperationAction,
  type CliUpgradeOperation,
  type CliVersionInfo,
  type CliVersionStatus,
  type ManagedCliProvider,
} from '@todex/protocol/v2';
import { CliAgentPage, cliPageTabs, SharedCapabilitiesPage, type CliPage } from '../components/cli/CliAgentPage';
import { InstructionPresetsModal } from '../components/cli/InstructionPresetsModal';
import { SettingsCard, SettingsEntry } from '../components/settings/SettingsRows';
import { ProviderIcon } from '../components/ProviderIcon';
import { NoticeToast } from '../components/NoticeToast';
import { getLocale, t, useT, type MessageKey } from '../i18n';
import type { TodeXSession } from '../session/useTodeXSession';
import { backendApi } from '../session/helpers';
import { usePanelBackend } from '../session/panelBackend';
import { BackendSelect } from '@/components/ui/backend-select';

type ChipColor = NonNullable<ChipProps['color']>;

const STATUS: Record<CliVersionStatus, { labelKey: MessageKey; color: ChipColor }> = {
  upToDate: { labelKey: 'cli.statusUpToDate', color: 'lime' },
  updateAvailable: { labelKey: 'cli.statusUpdateAvailable', color: 'yellow' },
  ahead: { labelKey: 'cli.statusAhead', color: 'neutral' },
  unknown: { labelKey: 'cli.statusUnknownLatest', color: 'neutral' },
  // Not installed is a normal state with an Install action, not a failure.
  notInstalled: { labelKey: 'cli.statusNotInstalled', color: 'neutral' },
  external: { labelKey: 'cli.statusExternal', color: 'neutral' },
};

/** Installed and updated with the container image: no upgrade or install here. */
const IMAGE_MANAGED_STATUS: { labelKey: MessageKey; color: ChipColor } = { labelKey: 'cli.statusImageManaged', color: 'neutral' };
const isImageManaged = (cli: CliVersionInfo) => cli.managedBy === 'image';

/**
 * The CLIs on a picked backend, as a settings category. Each installed CLI
 * opens its own page (settings, skills and MCPs, accounts, cleanup), which
 * replaces the list while `page` is set; this component stays mounted across
 * pages so the picked backend is kept.
 */
export function CliManagerPanel({ session, page = null, onPageChange = () => {} }: {
  session: TodeXSession;
  page?: CliPage | null;
  onPageChange?: (page: CliPage | null) => void;
}) {
  const t = useT();
  const [clis, setClis] = useState<CliVersionInfo[]>([]);
  const [checkedAt, setCheckedAt] = useState<string>();
  // The latest operation per CLI: several CLIs can install or upgrade at once.
  const [operations, setOperations] = useState<Partial<Record<ManagedCliProvider, CliUpgradeOperation>>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<ReadonlySet<ManagedCliProvider>>(() => new Set());
  const requestGeneration = useRef(0);
  const backendGeneration = useRef(0);
  // Read by the poll loop for toasts without restarting it on every refresh.
  const names = useRef(new Map<string, string>());
  names.current = new Map(clis.map((cli) => [cli.id, cli.name]));
  const backend = usePanelBackend(session);
  const { settings } = backend;
  const api = useCallback(() => backendApi(settings), [settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl]);

  /** `force` re-queries every CLI's latest release instead of the backend's cache. */
  const refresh = useCallback(async ({ quiet = false, force = false } = {}) => {
    const generation = ++requestGeneration.current;
    if (!quiet) setLoading(true);
    try {
      const response = await api().listCliVersions({ refresh: force });
      if (generation !== requestGeneration.current) return;
      setClis(response.clis);
      setCheckedAt(response.checkedAt);
      // Older backends report only one running operation.
      const active = response.activeOperations ?? (response.activeOperation ? [response.activeOperation] : []);
      // A running operation the list no longer reports has just finished;
      // keep it until its own poll reports the outcome. A list read before
      // an operation finished must not turn it back to running.
      setOperations((previous) => ({
        ...previous,
        ...Object.fromEntries(active
          .filter((item) => previous[item.provider]?.id !== item.id || previous[item.provider]?.status === 'running')
          .map((item) => [item.provider, item])),
      }));
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setClis([]);
      if (!quiet) toast.danger(error instanceof Error ? error.message : t('cli.readFailed'));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    backendGeneration.current += 1;
    setClis([]);
    setCheckedAt(undefined);
    setOperations({});
    setSubmitting(new Set());
    void refresh();
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

  const running = Object.values(operations).filter((item): item is CliUpgradeOperation => item?.status === 'running');
  const runningKey = running.map((item) => item.id).sort().join(',');
  // Poll failures are reported once per operation, across poll restarts.
  const reportedPollErrors = useRef(new Set<string>());

  // One timer polls every running operation; each finished one is toasted
  // and the list is refreshed once per round, however many finished.
  useEffect(() => {
    if (!running.length) return;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      const results = await Promise.allSettled(running.map((item) => api().getCliUpgrade(item.id)));
      if (cancelled) return;
      const updates: CliUpgradeOperation[] = [];
      let failedRead = false;
      results.forEach((result, index) => {
        const item = running[index];
        if (result.status === 'rejected') {
          failedRead = true;
          if (!reportedPollErrors.current.has(item.id)) {
            reportedPollErrors.current.add(item.id);
            const name = names.current.get(item.provider) ?? item.provider;
            const message = result.reason instanceof Error ? result.reason.message : t('cli.progressReadFailed');
            toast.danger(t('cli.namedError', { name, error: message }));
          }
          return;
        }
        reportedPollErrors.current.delete(item.id);
        updates.push(result.value);
      });
      const finished = updates.filter((next) => next.status !== 'running');
      for (const next of finished) {
        const name = names.current.get(next.provider) ?? next.provider;
        const installing = next.action === 'install';
        if (next.status === 'succeeded') {
          toast.success(next.currentVersion
            ? t(installing ? 'cli.installedNamedVersion' : 'cli.upgradedNamedVersion', { name, version: next.currentVersion })
            : t(installing ? 'cli.installedNamed' : 'cli.upgradedNamed', { name }));
        } else {
          toast.danger(t('cli.namedError', { name, error: next.error || t(installing ? 'cli.installFailed' : 'cli.upgradeFailed') }));
        }
      }
      if (updates.length) setOperations((previous) => ({ ...previous, ...Object.fromEntries(updates.map((next) => [next.provider, next])) }));
      if (finished.length) void refresh({ quiet: true });
      // A finished operation changes `runningKey`, which restarts this loop.
      if (finished.length < running.length) timer = window.setTimeout(() => void poll(), failedRead ? 2500 : 1200);
    };
    timer = window.setTimeout(() => void poll(), 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, runningKey, refresh]);

  const startOperation = async (provider: ManagedCliProvider, action: CliOperationAction) => {
    const generation = backendGeneration.current;
    setSubmitting((previous) => new Set(previous).add(provider));
    try {
      const next = action === 'install' ? await api().installCli(provider) : await api().upgradeCli(provider);
      if (generation === backendGeneration.current) setOperations((previous) => ({ ...previous, [provider]: next }));
    } catch (error) {
      if (generation === backendGeneration.current) {
        const fallback = action === 'install' ? t('cli.installStartFailed') : t('cli.upgradeStartFailed');
        const name = names.current.get(provider) ?? provider;
        toast.danger(t('cli.namedError', { name, error: error instanceof Error ? error.message : fallback }));
      }
    } finally {
      if (generation === backendGeneration.current) {
        setSubmitting((previous) => {
          const next = new Set(previous);
          next.delete(provider);
          return next;
        });
      }
    }
  };

  const [presetsOpen, setPresetsOpen] = useState(false);
  const [removingIntegration, setRemovingIntegration] = useState(false);
  // TodeX keeps a PreToolUse hook and its MCP servers in Antigravity's global
  // config (shared with the Antigravity app); this takes them out again.
  const removeAntigravityIntegration = async () => {
    setRemovingIntegration(true);
    try {
      const { removed } = await api().removeAntigravityIntegration();
      toast.success(t(removed ? 'cli.antigravityIntegrationRemoved' : 'cli.antigravityIntegrationAbsent'));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cli.antigravityIntegrationRemoveFailed'));
    } finally {
      setRemovingIntegration(false);
    }
  };

  const activeBackend = backend.profile;
  const isRunning = (id: string) => operations[id as ManagedCliProvider]?.status === 'running';
  const isBusy = (id: string) => isRunning(id) || submitting.has(id as ManagedCliProvider);
  const installed = clis.filter((cli) => cli.status !== 'notInstalled');
  const available = clis.filter((cli) => cli.status === 'notInstalled');
  // Collapsed by default; opens on its own when nothing is installed yet or
  // one of its CLIs is mid-install, so progress is never hidden.
  const [moreOpen, setMoreOpen] = useState(false);
  const showAvailable = moreOpen || !installed.length || available.some((cli) => isRunning(cli.id));
  // Only CLIs with a known newer release join "update all".
  const updatable = installed.filter((cli) => cli.kind === 'managed' && cli.upgradeSupported && !isImageManaged(cli) && cli.status === 'updateAvailable' && !isBusy(cli.id));
  const updateAll = () => {
    for (const cli of updatable) if (cli.kind === 'managed') void startOperation(cli.id, 'upgrade');
  };
  const checkedTime = checkedAt && !Number.isNaN(Date.parse(checkedAt))
    ? new Date(checkedAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
    : undefined;

  const renderInstalled = (cli: CliVersionInfo, index: number) => {
    const status = isImageManaged(cli) ? IMAGE_MANAGED_STATUS : STATUS[cli.status] ?? { labelKey: 'cli.statusUnknown' as MessageKey, color: 'neutral' as const };
    const operation = operations[cli.id as ManagedCliProvider];
    const running = operation?.status === 'running';
    // Only an available update, or an unknown latest version, offers the
    // upgrade; everything else just reports where the CLI stands.
    const upgradable = cli.kind === 'managed' && cli.upgradeSupported && !isImageManaged(cli) && (cli.status === 'updateAvailable' || cli.status === 'unknown');
    const target = cli.status === 'updateAvailable' ? cli.latestVersion : undefined;
    const hasPage = cli.kind === 'managed' && cliPageTabs(session, cli.id).length > 0;
    return (
      <div key={cli.id} className="flex flex-col">
        {index ? <Divider /> : null}
        <div className="flex min-w-0 items-center gap-3 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stat-card-icon-background">
            <ProviderIcon className="size-5" provider={cli.id} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-body-semibold text-text-primary">{cli.name}</h3>
            {cli.kind === 'managed' ? (
              <p className="truncate text-caption-1-regular text-text-secondary tabular-nums">
                {cli.currentVersion || t('cli.unavailable')}
                {cli.status === 'updateAvailable' && cli.latestVersion ? ` → ${cli.latestVersion}` : null}
              </p>
            ) : null}
          </div>
          {upgradable || running ? (
            <Button
              size="small"
              variant="secondary"
              leadingIcon={running ? SpinnerIcon : RiDownloadCloud2Line}
              aria-busy={running || undefined}
              disabled={isBusy(cli.id)}
              onClick={() => { if (cli.kind === 'managed') void startOperation(cli.id, 'upgrade'); }}
            >
              {running ? t('cli.upgradingNow') : target ? t('cli.upgradeTo', { version: target }) : t('cli.upgradeToLatest')}
            </Button>
          ) : (
            <Chip variant="caption" color={status.color}>{t(status.labelKey)}</Chip>
          )}
          {hasPage || cli.id === 'antigravity' ? (
            <div className="flex shrink-0 items-center gap-0.5">
              {cli.id === 'antigravity' ? (
                <IconAction
                  icon={removingIntegration ? SpinnerIcon : RiDeleteBin6Line}
                  size="sm"
                  aria-label={t('cli.antigravityRemoveIntegration')}
                  tooltip
                  aria-busy={removingIntegration || undefined}
                  disabled={removingIntegration}
                  onClick={() => void removeAntigravityIntegration()}
                />
              ) : null}
              {hasPage ? (
                <IconAction icon={RiSettings3Line} size="sm" aria-label={t('cliSettings.title', { name: cli.name })} tooltip={t('cliSettings.open')} onClick={() => onPageChange(cli.id)} />
              ) : null}
            </div>
          ) : null}
        </div>
        <NoticeToast message={cli.error && cli.error !== operation?.error ? t('cli.namedError', { name: cli.name, error: cli.error }) : null}
          variant="danger" scope={backend.backendId} />
      </div>
    );
  };

  // A page whose CLI went away (another backend, uninstalled) closes.
  const pageCli = page && page !== 'shared' ? installed.find((cli) => cli.id === page) : undefined;
  const pageGone = page !== null && page !== 'shared' && !loading && (!pageCli || pageCli.kind !== 'managed' || !cliPageTabs(session, pageCli.id).length);
  useEffect(() => {
    if (pageGone) onPageChange(null);
  }, [pageGone]);
  const sharedAvailable = session.v2Providers.some((item) => item.available);

  if (page === 'shared') return <SharedCapabilitiesPage session={session} onBack={() => onPageChange(null)} />;
  if (pageCli?.kind === 'managed' && !pageGone) {
    return <CliAgentPage key={`${backend.backendId}:${pageCli.id}`} session={session} backend={backend} api={api} id={pageCli.id} name={pageCli.name} onBack={() => onPageChange(null)} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2lg bg-badge-new-background text-badge-new-text">
          <RiServerLine aria-hidden className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-headline-semibold text-text-primary">{activeBackend?.name || t('cli.currentBackend')}</h2>
          <p className="truncate text-caption-1-regular text-text-secondary" title={settings.serverUrl}>
            {settings.serverUrl}
            {checkedTime ? ` · ${t('cli.checkedAt', { time: checkedTime })}` : null}
          </p>
        </div>
        <BackendSelect profiles={session.backendConnections} linkStates={session.backendLinkStatus} selectedId={backend.backendId} onChange={backend.setBackendId} />
        <Button size="small" variant="secondary" leadingIcon={RiFileList3Line} onClick={() => setPresetsOpen(true)}>{t('instructionPresets.open')}</Button>
        <IconAction icon={RiRefreshLine} size="md" aria-label={t('cli.refreshAria')} disabled={loading} onClick={() => void refresh({ force: true })} />
      </div>

      {sharedAvailable ? (
        <SettingsCard className="overflow-hidden ps-0">
          <SettingsEntry icon={RiPuzzle2Line} title={t('cliPage.shared')} description={t('cliPage.sharedHint')} onPress={() => onPageChange('shared')} />
        </SettingsCard>
      ) : null}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('cli.reading')} /></div>
      ) : (
        <>
          {updatable.length > 1 ? (
            <div className="flex justify-end">
              <Button size="small" variant="secondary" leadingIcon={RiDownloadCloud2Line} onClick={updateAll}>
                {t('cli.upgradeAll', { count: updatable.length })}
              </Button>
            </div>
          ) : null}
          {installed.length ? (
            <Card variant="secondary" className="gap-0 py-1">{installed.map(renderInstalled)}</Card>
          ) : clis.length ? (
            <EmptyState size="sm" icon={RiTerminalBoxLine} title={t('cli.noneInstalled')} />
          ) : null}
          {available.length ? (
            <section className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={showAvailable}
                aria-controls="cli-install-more"
                onClick={() => setMoreOpen(!showAvailable)}
                className={cx(
                  'flex w-full cursor-pointer items-center gap-2 rounded-2lg px-1 py-1.5 text-start',
                  'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                )}
              >
                <span className="text-body-semibold text-text-primary">{t('cli.installMore')}</span>
                <Chip variant="caption" color="neutral">{available.length}</Chip>
                <span className="min-w-0 flex-1 truncate text-caption-1-regular text-text-secondary">{t('cli.installMoreHint')}</span>
                <RiArrowDownSLine aria-hidden className={cx('size-5 shrink-0 text-foreground-icon-secondary transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]', showAvailable && 'rotate-180')} />
              </button>
              {showAvailable ? (
                <Card id="cli-install-more" variant="secondary" className="gap-0 py-1">
                  {available.map((cli, index) => {
                    const running = isRunning(cli.id);
                    return (
                      <div key={cli.id} className="flex flex-col">
                        {index ? <Divider /> : null}
                        <div className="flex min-w-0 items-center gap-3 py-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stat-card-icon-background">
                            <ProviderIcon className="size-5" provider={cli.id} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-body-semibold text-text-primary">{cli.name}</h3>
                            <p className="truncate text-caption-1-regular text-text-secondary tabular-nums">
                              {t('cli.latestVersion')} {cli.latestVersion || t('cli.notFetched')}
                            </p>
                          </div>
                          {isImageManaged(cli) ? (
                            <Chip variant="caption" color={IMAGE_MANAGED_STATUS.color}>{t(IMAGE_MANAGED_STATUS.labelKey)}</Chip>
                          ) : cli.kind === 'managed' ? (
                            <Button
                              size="small"
                              variant="secondary"
                              leadingIcon={running ? SpinnerIcon : RiDownload2Line}
                              aria-busy={running || undefined}
                              disabled={!cli.installSupported || isBusy(cli.id)}
                              onClick={() => void startOperation(cli.id, 'install')}
                            >
                              {running ? t('cli.installingNow') : t('cli.install')}
                            </Button>
                          ) : (
                            <Chip variant="caption" color="neutral">{t('cli.statusExternal')}</Chip>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </Card>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      <InstructionPresetsModal isOpen={presetsOpen} onClose={() => setPresetsOpen(false)} api={api} />
    </div>
  );
}

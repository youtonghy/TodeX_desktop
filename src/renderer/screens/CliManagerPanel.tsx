import { useCallback, useEffect, useRef, useState } from 'react';
import { RiArrowDownSLine, RiDeleteBin6Line, RiDownload2Line, RiDownloadCloud2Line, RiFileList3Line, RiRefreshLine, RiServerLine, RiSettings3Line, RiTerminalBoxLine } from '@remixicon/react';
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
  type CliSettingsProvider,
  type CliVersionStatus,
  type ManagedCliProvider,
} from '@todex/protocol/v2';
import { CliSettingsModal } from '../components/cli/CliSettingsModal';
import { InstructionPresetsModal } from '../components/cli/InstructionPresetsModal';
import { hasCliSettings } from '../lib/cliSettings';
import { ProviderIcon } from '../components/ProviderIcon';
import { NoticeToast } from '../components/NoticeToast';
import { t, useT, type MessageKey } from '../i18n';
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

export function CliManagerPanel({ session }: { session: TodeXSession }) {
  const t = useT();
  const [clis, setClis] = useState<CliVersionInfo[]>([]);
  const [operation, setOperation] = useState<CliUpgradeOperation>();
  const [loading, setLoading] = useState(true);
  const [submittingProvider, setSubmittingProvider] = useState<ManagedCliProvider>();
  const requestGeneration = useRef(0);
  const backendGeneration = useRef(0);
  const backend = usePanelBackend(session);
  const { settings } = backend;
  const api = useCallback(() => backendApi(settings), [settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl]);

  const refresh = useCallback(async (quiet = false) => {
    const generation = ++requestGeneration.current;
    if (!quiet) setLoading(true);
    try {
      const response = await api().listCliVersions();
      if (generation !== requestGeneration.current) return;
      setClis(response.clis);
      setOperation(response.activeOperation);
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
    setOperation(undefined);
    setSubmittingProvider(undefined);
    void refresh();
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (!operation || operation.status !== 'running') return;
    let cancelled = false;
    let timer = 0;
    let reportedPollError = false;
    const poll = async () => {
      try {
        const next = await api().getCliUpgrade(operation.id);
        if (cancelled) return;
        reportedPollError = false;
        setOperation(next);
        const installing = next.action === 'install';
        if (next.status === 'succeeded') {
          toast.success(t(installing ? 'cli.installed' : 'cli.upgraded'));
          void refresh(true);
        } else if (next.status === 'failed') {
          toast.danger(next.error || t(installing ? 'cli.installFailed' : 'cli.upgradeFailed'));
        } else {
          timer = window.setTimeout(() => void poll(), 1200);
        }
      } catch (error) {
        if (cancelled) return;
        if (!reportedPollError) {
          reportedPollError = true;
          toast.danger(error instanceof Error ? error.message : t('cli.progressReadFailed'));
        }
        timer = window.setTimeout(() => void poll(), 2500);
      }
    };
    timer = window.setTimeout(() => void poll(), 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, operation, refresh]);

  const startOperation = async (provider: ManagedCliProvider, action: CliOperationAction) => {
    const generation = backendGeneration.current;
    setSubmittingProvider(provider);
    try {
      const next = action === 'install' ? await api().installCli(provider) : await api().upgradeCli(provider);
      if (generation === backendGeneration.current) setOperation(next);
    } catch (error) {
      if (generation === backendGeneration.current) {
        const fallback = action === 'install' ? t('cli.installStartFailed') : t('cli.upgradeStartFailed');
        toast.danger(error instanceof Error ? error.message : fallback);
      }
    } finally {
      if (generation === backendGeneration.current) setSubmittingProvider(undefined);
    }
  };

  const [settingsProvider, setSettingsProvider] = useState<CliSettingsProvider | null>(null);
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
  const operationBusy = operation?.status === 'running' || Boolean(submittingProvider);
  const installed = clis.filter((cli) => cli.status !== 'notInstalled');
  const available = clis.filter((cli) => cli.status === 'notInstalled');
  // Collapsed by default; opens on its own when nothing is installed yet or
  // one of its CLIs is mid-install, so progress is never hidden.
  const [moreOpen, setMoreOpen] = useState(false);
  const showAvailable = moreOpen || !installed.length || available.some((cli) => operation?.provider === cli.id && operation.status === 'running');

  const renderInstalled = (cli: CliVersionInfo, index: number) => {
    const status = STATUS[cli.status] ?? { labelKey: 'cli.statusUnknown' as MessageKey, color: 'neutral' as const };
    const running = operation?.provider === cli.id && operation.status === 'running';
    // Only an available update, or an unknown latest version, offers the
    // upgrade; everything else just reports where the CLI stands.
    const upgradable = cli.kind === 'managed' && cli.upgradeSupported && (cli.status === 'updateAvailable' || cli.status === 'unknown');
    const target = cli.status === 'updateAvailable' ? cli.latestVersion : undefined;
    const settingsId = hasCliSettings(cli.id) ? cli.id : null;
    return (
      <div key={cli.id} className="flex flex-col">
        {index ? <Divider /> : null}
        <div className="flex min-w-0 items-center gap-3 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stat-card-icon-background">
            <ProviderIcon className="size-5" provider={cli.id} />
          </div>
          <h3 className="min-w-0 flex-1 truncate text-body-semibold text-text-primary">{cli.name}</h3>
          {upgradable || running ? (
            <Button
              size="small"
              variant="secondary"
              leadingIcon={running ? SpinnerIcon : RiDownloadCloud2Line}
              aria-busy={running || undefined}
              disabled={running || operationBusy}
              onClick={() => { if (cli.kind === 'managed') void startOperation(cli.id, 'upgrade'); }}
            >
              {running ? t('cli.upgradingNow') : target ? t('cli.upgradeTo', { version: target }) : t('cli.upgradeToLatest')}
            </Button>
          ) : (
            <Chip variant="caption" color={status.color}>{t(status.labelKey)}</Chip>
          )}
          {settingsId || cli.id === 'antigravity' ? (
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
              {settingsId ? (
                <IconAction icon={RiSettings3Line} size="sm" aria-label={t('cliSettings.title', { name: cli.name })} tooltip={t('cliSettings.open')} onClick={() => setSettingsProvider(settingsId)} />
              ) : null}
            </div>
          ) : null}
        </div>
        <NoticeToast message={cli.error && cli.error !== operation?.error ? t('cli.namedError', { name: cli.name, error: cli.error }) : null}
          variant="danger" scope={backend.backendId} />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2lg bg-badge-new-background text-badge-new-text">
          <RiServerLine aria-hidden className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-headline-semibold text-text-primary">{activeBackend?.name || t('cli.currentBackend')}</h2>
          <p className="truncate text-caption-1-regular text-text-secondary" title={settings.serverUrl}>{settings.serverUrl}</p>
        </div>
        <BackendSelect profiles={session.backendConnections} linkStates={session.backendLinkStatus} selectedId={backend.backendId} onChange={backend.setBackendId} />
        <Button size="small" variant="secondary" leadingIcon={RiFileList3Line} onClick={() => setPresetsOpen(true)}>{t('instructionPresets.open')}</Button>
        <IconAction icon={RiRefreshLine} size="md" aria-label={t('cli.refreshAria')} disabled={loading} onClick={() => void refresh()} />
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('cli.reading')} /></div>
      ) : (
        <>
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
                    const running = operation?.provider === cli.id && operation.status === 'running';
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
                          {cli.kind === 'managed' ? (
                            <Button
                              size="small"
                              variant="secondary"
                              leadingIcon={running ? SpinnerIcon : RiDownload2Line}
                              aria-busy={running || undefined}
                              disabled={!cli.installSupported || operationBusy}
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
      <CliSettingsModal provider={settingsProvider} onClose={() => setSettingsProvider(null)} api={api} />
      <InstructionPresetsModal isOpen={presetsOpen} onClose={() => setPresetsOpen(false)} api={api} />
    </div>
  );
}

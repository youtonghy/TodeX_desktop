import { useCallback, useEffect, useRef, useState } from 'react';
import { RiDeleteBin6Line, RiDownload2Line, RiDownloadCloud2Line, RiFileList3Line, RiRefreshLine, RiServerLine, RiSettings3Line } from '@remixicon/react';
import { Chip, type ChipProps } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Card } from '@/components/ui/card';
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

type ChipColor = NonNullable<ChipProps['color']>;

/** Low-emphasis full-width card action under the primary button. */
const QUIET_ACTION = cx(
  'inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-2lg px-2 py-1.5',
  'text-body-medium text-text-secondary transition-colors duration-150 ease',
  'hover:bg-background-secondary-hover hover:text-text-primary active:bg-background-tertiary-default',
  'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
);

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
  const api = useCallback(() => backendApi(session.settings), [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.transportVerified, session.settings.serverUrl]);

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

  const activeBackend = session.backendConnections.find((item) => item.id === session.activeBackendConnectionId);

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2lg bg-badge-new-background text-badge-new-text">
          <RiServerLine aria-hidden className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-headline-semibold text-text-primary">{activeBackend?.name || t('cli.currentBackend')}</h2>
          <p className="truncate text-caption-1-regular text-text-secondary" title={session.settings.serverUrl}>{session.settings.serverUrl}</p>
        </div>
        <Button size="small" variant="secondary" leadingIcon={RiFileList3Line} onClick={() => setPresetsOpen(true)}>{t('instructionPresets.open')}</Button>
        <IconAction icon={RiRefreshLine} size="md" aria-label={t('cli.refreshAria')} disabled={loading} onClick={() => void refresh()} />
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('cli.reading')} /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clis.map((cli) => {
            const status = STATUS[cli.status] ?? { labelKey: 'cli.statusUnknown' as MessageKey, color: 'neutral' as const };
            const running = operation?.provider === cli.id && operation.status === 'running';
            const installing = running && operation?.action === 'install';
            const notInstalled = cli.status === 'notInstalled';
            // Older backends attach the lookup failure to a missing CLI.
            const error = notInstalled ? undefined : cli.error;
            const busyLabel = installing ? t('cli.installing') : t('cli.upgrading');
            const showRemoveIntegration = cli.id === 'antigravity' && !notInstalled;
            const settingsId = hasCliSettings(cli.id) && !notInstalled ? cli.id : null;
            return (
              <Card key={cli.id} variant="secondary" className="min-w-0 gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-stat-card-icon-background">
                    <ProviderIcon className="size-5" provider={cli.id} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-body-semibold text-text-primary">{cli.name}</h3>
                      <Chip variant="caption" color={status.color}>{running ? busyLabel : t(status.labelKey)}</Chip>
                    </div>
                    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption-1-regular">
                      <dt className="text-text-secondary">{t('cli.currentVersion')}</dt><dd className="truncate text-caption-1-medium text-text-primary tabular-nums">{cli.currentVersion || t(notInstalled ? 'cli.statusNotInstalled' : 'cli.unavailable')}</dd>
                      <dt className="text-text-secondary">{t('cli.latestVersion')}</dt><dd className="truncate text-caption-1-medium text-text-primary tabular-nums">{cli.latestVersion || t('cli.notFetched')}</dd>
                    </dl>
                    <NoticeToast message={error && error !== operation?.error ? t('cli.namedError', { name: cli.name, error }) : null}
                      variant="danger" scope={session.activeBackendConnectionId} />
                  </div>
                </div>
                {cli.kind === 'managed' || showRemoveIntegration || settingsId ? (
                  <div className="flex flex-col gap-2">
                    {cli.kind === 'managed' && notInstalled ? (
                      <Button
                        className="w-full"
                        size="small"
                        variant="secondary"
                        leadingIcon={running ? SpinnerIcon : RiDownload2Line}
                        aria-busy={running || undefined}
                        disabled={!cli.installSupported || Boolean(operation?.status === 'running') || Boolean(submittingProvider)}
                        onClick={() => void startOperation(cli.id, 'install')}
                      >
                        {running ? t('cli.installingNow') : t('cli.install')}
                      </Button>
                    ) : cli.kind === 'managed' ? (
                      <Button
                        className="w-full"
                        size="small"
                        variant="secondary"
                        leadingIcon={running ? SpinnerIcon : RiDownloadCloud2Line}
                        aria-busy={running || undefined}
                        disabled={!cli.upgradeSupported || Boolean(operation?.status === 'running') || Boolean(submittingProvider)}
                        onClick={() => void startOperation(cli.id, 'upgrade')}
                      >
                        {running ? t('cli.upgradingNow') : t('cli.upgradeToLatest')}
                      </Button>
                    ) : null}
                    {showRemoveIntegration ? (
                      <button
                        type="button"
                        aria-busy={removingIntegration || undefined}
                        disabled={removingIntegration}
                        onClick={() => void removeAntigravityIntegration()}
                        className={QUIET_ACTION}
                      >
                        {removingIntegration ? <Spinner size="sm" /> : <RiDeleteBin6Line aria-hidden className="size-4 text-foreground-icon-secondary" />}
                        {t('cli.antigravityRemoveIntegration')}
                      </button>
                    ) : null}
                    {settingsId ? (
                      <button type="button" onClick={() => setSettingsProvider(settingsId)} className={QUIET_ACTION}>
                        <RiSettings3Line aria-hidden className="size-4 text-foreground-icon-secondary" />
                        {t('cliSettings.open')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
      <CliSettingsModal provider={settingsProvider} onClose={() => setSettingsProvider(null)} api={api} />
      <InstructionPresetsModal isOpen={presetsOpen} onClose={() => setPresetsOpen(false)} api={api} />
    </div>
  );
}

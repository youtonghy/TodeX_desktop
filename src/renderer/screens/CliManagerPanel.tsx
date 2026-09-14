import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Spinner, toast } from '@heroui/react';
import { RiDownloadCloud2Line, RiRefreshLine, RiServerLine } from '@remixicon/react';
import {
  V2ApiClient,
  type CliUpgradeOperation,
  type CliVersionInfo,
  type CliVersionStatus,
  type ManagedCliProvider,
} from '@todex/protocol/v2';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { ProviderIcon } from '../components/ProviderIcon';
import { NoticeToast } from '../components/NoticeToast';
import { t, useT, type MessageKey } from '../i18n';
import type { TodeXSession } from '../session/useTodeXSession';

const STATUS: Record<CliVersionStatus, { labelKey: MessageKey; color: 'success' | 'warning' | 'default' | 'danger' }> = {
  upToDate: { labelKey: 'cli.statusUpToDate', color: 'success' },
  updateAvailable: { labelKey: 'cli.statusUpdateAvailable', color: 'warning' },
  ahead: { labelKey: 'cli.statusAhead', color: 'default' },
  unknown: { labelKey: 'cli.statusUnknownLatest', color: 'default' },
  notInstalled: { labelKey: 'cli.statusNotInstalled', color: 'danger' },
  external: { labelKey: 'cli.statusExternal', color: 'default' },
};

export function CliManagerPanel({ session }: { session: TodeXSession }) {
  const t = useT();
  const [clis, setClis] = useState<CliVersionInfo[]>([]);
  const [operation, setOperation] = useState<CliUpgradeOperation>();
  const [loading, setLoading] = useState(true);
  const [submittingProvider, setSubmittingProvider] = useState<ManagedCliProvider>();
  const requestGeneration = useRef(0);
  const backendGeneration = useRef(0);
  const api = useCallback(() => new V2ApiClient({
    serverUrl: session.settings.serverUrl,
    device: deviceIdentityFromSecret(session.settings.deviceSecret),
  }), [session.settings.deviceSecret, session.settings.serverUrl]);

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
        if (next.status === 'succeeded') {
          toast.success(t('cli.upgraded'));
          void refresh(true);
        } else if (next.status === 'failed') {
          toast.danger(next.error || t('cli.upgradeFailed'));
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

  const upgrade = async (provider: ManagedCliProvider) => {
    const generation = backendGeneration.current;
    setSubmittingProvider(provider);
    try {
      const next = await api().upgradeCli(provider);
      if (generation === backendGeneration.current) setOperation(next);
    } catch (error) {
      if (generation === backendGeneration.current) {
        toast.danger(error instanceof Error ? error.message : t('cli.upgradeStartFailed'));
      }
    } finally {
      if (generation === backendGeneration.current) setSubmittingProvider(undefined);
    }
  };

  const activeBackend = session.backendConnections.find((item) => item.id === session.activeBackendConnectionId);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="bg-accent-soft text-accent flex size-10 shrink-0 items-center justify-center rounded-lg">
          <RiServerLine className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{activeBackend?.name || t('cli.currentBackend')}</h2>
          <p className="text-muted truncate text-xs" title={session.settings.serverUrl}>{session.settings.serverUrl}</p>
        </div>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('cli.refreshAria')} isDisabled={loading} onPress={() => void refresh()}>
          <RiRefreshLine className="size-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner aria-label={t('cli.reading')} /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clis.map((cli) => {
            const status = STATUS[cli.status] ?? { labelKey: 'cli.statusUnknown' as MessageKey, color: 'default' as const };
            const upgrading = operation?.provider === cli.id && operation.status === 'running';
            return (
              <Card key={cli.id} className="min-w-0 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="bg-surface-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <ProviderIcon className="size-5" provider={cli.id} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{cli.name}</h3>
                      <Chip size="sm" variant="soft" color={status.color}>{upgrading ? t('cli.upgrading') : t(status.labelKey)}</Chip>
                    </div>
                    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted">{t('cli.currentVersion')}</dt><dd className="truncate font-medium tabular-nums">{cli.currentVersion || t('cli.unavailable')}</dd>
                      <dt className="text-muted">{t('cli.latestVersion')}</dt><dd className="truncate font-medium tabular-nums">{cli.latestVersion || t('cli.notFetched')}</dd>
                    </dl>
                    <NoticeToast message={cli.error && cli.error !== operation?.error ? t('cli.namedError', { name: cli.name, error: cli.error }) : null}
                      variant="danger" scope={session.activeBackendConnectionId} />
                  </div>
                </div>
                {cli.kind === 'managed' ? (
                  <Button
                    className="mt-4 w-full"
                    size="sm"
                    variant={cli.status === 'updateAvailable' ? 'primary' : 'secondary'}
                    isDisabled={!cli.upgradeSupported || Boolean(operation?.status === 'running') || Boolean(submittingProvider)}
                    onPress={() => void upgrade(cli.id)}
                  >
                    {upgrading ? <Spinner size="sm" /> : <RiDownloadCloud2Line className="size-4" />}
                    {upgrading ? t('cli.upgradingNow') : t('cli.upgradeToLatest')}
                  </Button>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

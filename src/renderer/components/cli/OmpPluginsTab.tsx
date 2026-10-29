import { useCallback, useEffect, useState } from 'react';
import { RiAddLine, RiArrowUpCircleLine, RiDeleteBin6Line } from '@remixicon/react';
import type { OmpPlugin, OmpPluginList, OmpPluginOperation, V2ApiClient } from '@todex/protocol/v2';
import { Button } from '@/components/base/buttons/button';
import { Chip } from '@/components/base/badges/chip';
import { Input } from '@/components/base/input/input';
import { Switch } from '@/components/base/switch/switch';
import { SettingsCard, SettingsGroup, SettingsRow } from '@/components/settings/SettingsRows';
import { Alert } from '@/components/ui/alert';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmDialog } from '@/components/ui/modal';
import { Spinner, SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useT, type MessageKey } from '@/i18n';

const POLL_MS = 1500;
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type Action = OmpPluginOperation['action'];

const RUNNING: Record<Action, MessageKey> = {
  install: 'ompPlugins.installing',
  uninstall: 'ompPlugins.uninstalling',
  upgrade: 'ompPlugins.upgrading',
};
const DONE: Record<Action, MessageKey> = {
  install: 'ompPlugins.installed',
  uninstall: 'ompPlugins.uninstalled',
  upgrade: 'ompPlugins.upgraded',
};

/**
 * omp's user-scope plugins, managed through `omp plugin` on the backend.
 * Switches apply at once; installs, removals and upgrades run in the
 * background and are polled until they end.
 */
export function OmpPluginsTab({ api }: { api: () => V2ApiClient }) {
  const t = useT();
  const [list, setList] = useState<OmpPluginList>();
  const [loadError, setLoadError] = useState<string>();
  const [toggling, setToggling] = useState<string>();
  const [operation, setOperation] = useState<OmpPluginOperation>();
  const [installSpec, setInstallSpec] = useState('');
  const [confirm, setConfirm] = useState<{ action: Action; spec: string } | null>(null);
  const running = operation?.status === 'running';

  const load = useCallback(async () => {
    setLoadError(undefined);
    try {
      setList(await api().listOmpPlugins());
    } catch (error) {
      setLoadError(errorText(error, t('ompPlugins.readFailed')));
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  // Polls a running operation until it ends.
  useEffect(() => {
    if (!operation || operation.status !== 'running') return;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api().getOmpPluginOperation(operation.id);
        setOperation(next);
        if (next.status === 'running') return;
        if (next.status === 'succeeded') toast.success(t(DONE[next.action], { name: next.spec }));
        else toast.danger(t('ompPlugins.failed', { name: next.spec, message: next.error ?? '' }));
        await load();
      } catch (error) {
        setOperation({ ...operation, status: 'failed', error: errorText(error, t('ompPlugins.readFailed')) });
      }
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [operation, api, load]);

  const toggle = async (plugin: OmpPlugin, enabled: boolean) => {
    setToggling(plugin.name);
    try {
      setList(await api().setOmpPluginEnabled(plugin.name, enabled));
    } catch (error) {
      toast.danger(errorText(error, t('ompPlugins.toggleFailed')));
    } finally {
      setToggling(undefined);
    }
  };

  const start = async (action: Action, spec: string) => {
    try {
      setOperation(await api().startOmpPluginOperation(action, spec));
      return true;
    } catch (error) {
      toast.danger(errorText(error, t('ompPlugins.failed', { name: spec, message: '' })));
      return false;
    }
  };

  if (loadError) {
    return (
      <Alert
        status="danger"
        title={t('ompPlugins.readFailed')}
        description={loadError}
        actions={<Button size="small" variant="secondary" onClick={() => void load()}>{t('cliSettings.retry')}</Button>}
      />
    );
  }
  if (!list) {
    return <div className="flex min-h-48 items-center justify-center"><Spinner size="md" aria-label={t('ompPlugins.reading')} /></div>;
  }

  const busy = running || Boolean(toggling);
  return (
    <div className="flex flex-col gap-5">
      <p className="px-3 text-body-2-regular text-text-secondary">{t('ompPlugins.intro', { count: list.plugins.length })}</p>
      {list.error ? <Alert status="warning" title={t('ompPlugins.listError')} description={list.error} /> : null}
      {running && operation ? <Alert status="info" icon={SpinnerIcon} title={t(RUNNING[operation.action], { name: operation.spec })} /> : null}
      {list.plugins.length === 0 && !list.error ? <p className="px-3 text-body-regular text-text-secondary">{t('ompPlugins.empty')}</p> : null}
      {list.plugins.length > 0 ? (
        <SettingsGroup label={t('ompPlugins.installedGroup')}>
          <SettingsCard>
            {list.plugins.map((plugin) => (
              <SettingsRow
                key={plugin.name}
                label={(
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate font-mono text-body-2-medium" dir="ltr" title={plugin.name}>{plugin.name}</span>
                    {plugin.version ? <span className="shrink-0 text-caption-1-regular text-text-tertiary" dir="ltr">{plugin.version}</span> : null}
                  </span>
                )}
                description={plugin.description}
              >
                {plugin.features.length > 0 ? (
                  <Chip variant="caption" color="neutral">
                    {t('ompPlugins.features', { count: (plugin.enabledFeatures ?? plugin.features).length, total: plugin.features.length })}
                  </Chip>
                ) : null}
                <IconAction
                  icon={RiArrowUpCircleLine}
                  size="sm"
                  tooltip={t('ompPlugins.upgradeAction')}
                  aria-label={t('ompPlugins.upgradeOf', { name: plugin.name })}
                  disabled={busy}
                  onClick={() => void start('upgrade', plugin.name)}
                />
                <IconAction
                  icon={RiDeleteBin6Line}
                  size="sm"
                  tooltip={t('ompPlugins.uninstallAction')}
                  aria-label={t('ompPlugins.uninstallOf', { name: plugin.name })}
                  disabled={busy}
                  onClick={() => setConfirm({ action: 'uninstall', spec: plugin.name })}
                />
                <Switch
                  size="sm"
                  aria-label={t('ompPlugins.enable', { name: plugin.name })}
                  isSelected={plugin.enabled}
                  isDisabled={busy}
                  onChange={(enabled) => void toggle(plugin, enabled)}
                />
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsGroup>
      ) : null}
      {list.marketplace.length > 0 ? (
        <SettingsGroup label={t('ompPlugins.marketplace')} description={t('ompPlugins.marketplaceHint')}>
          <SettingsCard>
            {list.marketplace.map((plugin) => (
              <SettingsRow
                key={`${plugin.scope}:${plugin.id}`}
                label={<span className="truncate font-mono text-body-2-medium" dir="ltr">{plugin.id}</span>}
                description={plugin.version ? <span dir="ltr">{plugin.version}</span> : undefined}
              >
                <Chip variant="caption" color="neutral">{plugin.scope}</Chip>
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsGroup>
      ) : null}
      <SettingsGroup label={t('ompPlugins.install')} description={t('ompPlugins.installHint')}>
        <SettingsCard>
          <div className="flex items-center gap-2 py-2.5 pe-2.5">
            <Input
              aria-label={t('ompPlugins.installSpec')}
              size="small"
              className="min-w-0 flex-1"
              inputDir="ltr"
              placeholder="@scope/omp-plugin"
              value={installSpec}
              onChange={setInstallSpec}
              inputClassName="font-mono"
            />
            <Button
              size="small"
              variant="secondary"
              leadingIcon={RiAddLine}
              disabled={!installSpec.trim() || running}
              onClick={() => setConfirm({ action: 'install', spec: installSpec.trim() })}
            >
              {t('ompPlugins.installAction')}
            </Button>
          </div>
        </SettingsCard>
      </SettingsGroup>
      <ConfirmDialog
        isOpen={Boolean(confirm)}
        onOpenChange={(open) => { if (!open) setConfirm(null); }}
        title={t(confirm?.action === 'uninstall' ? 'ompPlugins.uninstallTitle' : 'ompPlugins.installTitle')}
        description={confirm ? t(confirm.action === 'uninstall' ? 'ompPlugins.uninstallBody' : 'ompPlugins.installBody', { name: confirm.spec }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={t(confirm?.action === 'uninstall' ? 'ompPlugins.uninstallAction' : 'ompPlugins.installAction')}
        tone={confirm?.action === 'uninstall' ? 'danger' : 'default'}
        onConfirm={async () => {
          if (!confirm) return;
          const started = await start(confirm.action, confirm.spec);
          if (started && confirm.action === 'install') setInstallSpec('');
          setConfirm(null);
        }}
      />
    </div>
  );
}

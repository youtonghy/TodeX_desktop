import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Description, Label, ListBox, Select, Surface, Switch, toast } from '@heroui/react';
import { RiAddLine, RiDeleteBinLine } from '@remixicon/react';
import type { AgentDesktopSettings as Settings } from '@todex/protocol/agentDesktop';
import { ConnectionError } from '@todex/protocol/connectionError';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { V2ApiClient } from '@todex/protocol/v2';
import type { AgentBrowserPartitionState } from '../../preload/index';
import { ComputerUseSettings } from './ComputerUseSettings';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';

/** Store keys read by the main process (`agentDesktop/profiles.ts`). */
const EXECUTOR_ENABLED_KEY = 'todex.desktop.agentDesktopExecutor.v1';

function SettingSwitch({ selected, disabled, onChange, title, hint }: {
  selected: boolean; disabled?: boolean; onChange: (selected: boolean) => void; title: string; hint: string;
}) {
  return (
    <Switch isSelected={selected} isDisabled={disabled} onChange={onChange}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted text-xs">{hint}</p>
        </div>
      </Switch.Content>
    </Switch>
  );
}

/**
 * Agent desktop tools for the active backend: the backend switch and its
 * online executors, whether this desktop serves as one, and the agent
 * browser's per-workspace partitions (desktop only).
 */
export function AgentDesktopSettings({ session }: { session: TodeXSession }) {
  const t = useT();
  const api = useMemo(
    () => new V2ApiClient({ serverUrl: session.settings.serverUrl, device: deviceIdentityFromSecret(session.settings.deviceSecret) }),
    [session.settings.deviceSecret, session.settings.serverUrl],
  );
  // `null`: the backend predates desktop tools.
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [executorEnabled, setExecutorEnabled] = useState(true);
  const [partitions, setPartitions] = useState<AgentBrowserPartitionState>({ partitions: [], workspaces: {} });
  const desktop = window.todexDesktop;

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.getAgentDesktop());
    } catch (error) {
      setSettings(error instanceof ConnectionError && error.httpStatus === 404 ? null : undefined);
    }
  }, [api]);
  useEffect(() => {
    void refresh();
    void desktop.store.get(EXECUTOR_ENABLED_KEY).then(value => setExecutorEnabled(value !== false));
    void desktop.agentBrowser.partitions().then(setPartitions);
    // Executors come and go; keep the list current while settings are open.
    // Computer Use permissions are granted on the host, outside the app.
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [desktop, refresh]);

  const setEnabled = async (enabled: boolean) => {
    setSaving(true);
    try {
      setSettings(await api.setAgentDesktopEnabled(enabled));
      desktop.agentBrowser.refreshExecutors();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentDesktop.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setComputerEnabled = async (computerEnabled: boolean) => {
    setSaving(true);
    try {
      setSettings(await api.setAgentComputerEnabled(computerEnabled));
      desktop.agentBrowser.refreshExecutors();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentDesktop.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const requestComputerPermissions = async () => {
    setSaving(true);
    try {
      setSettings(await api.requestComputerPermissions());
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentDesktop.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setLocalExecutor = async (enabled: boolean) => {
    setExecutorEnabled(enabled);
    await desktop.store.set(EXECUTOR_ENABLED_KEY, enabled);
  };

  const profileId = session.activeWorkspace?.backendConnectionId || session.activeBackendConnectionId;
  const workspace = session.activeWorkspace;
  const workspaceKeys = workspace ? [`${profileId}:${workspace.id}`, `${profileId}:${workspace.path}`] : [];
  const currentKey = workspaceKeys.find(key => partitions.workspaces[key]) ?? workspaceKeys[0];
  const currentPartition = currentKey ? partitions.workspaces[currentKey] : undefined;
  const workspaceNames = (partitionId: string) => Object.entries(partitions.workspaces)
    .filter(([, id]) => id === partitionId)
    .map(([key]) => {
      const rest = key.slice(key.indexOf(':') + 1);
      return session.workspaces.find(item => item.id === rest || item.path === rest)?.name || rest.split(/[\\/]/).pop() || rest;
    });

  const reloadPartitions = async () => setPartitions(await desktop.agentBrowser.partitions());
  const assign = async (partitionId: string) => {
    if (!currentKey) return;
    await desktop.agentBrowser.assignPartition(currentKey, partitionId);
    await reloadPartitions();
  };
  const create = async () => {
    const record = await desktop.agentBrowser.createPartition(t('agentDesktop.partitionDefaultName', { n: partitions.partitions.length + 1 }));
    if (currentKey) await desktop.agentBrowser.assignPartition(currentKey, record.id);
    await reloadPartitions();
  };
  const remove = async (partitionId: string, name: string) => {
    if (!window.confirm(t('agentDesktop.partitionDeleteConfirm', { name }))) return;
    try {
      await desktop.agentBrowser.deletePartition(partitionId);
      await reloadPartitions();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentDesktop.saveFailed'));
    }
  };

  if (settings === null) {
    return (
      <Surface className="flex flex-col gap-2 rounded-2xl p-5">
        <h3 className="font-semibold">{t('agentDesktop.title')}</h3>
        <p className="text-muted text-sm">{t('agentDesktop.unsupported')}</p>
      </Surface>
    );
  }
  return (
    <Surface className="flex flex-col gap-4 rounded-2xl p-5">
      <h3 className="font-semibold">{t('agentDesktop.title')}</h3>
      <SettingSwitch
        selected={settings?.enabled ?? false}
        disabled={settings === undefined || saving}
        onChange={selected => { void setEnabled(selected); }}
        title={t('agentDesktop.enable')}
        hint={t('agentDesktop.enableHint')}
      />
      <SettingSwitch
        selected={executorEnabled}
        onChange={selected => { void setLocalExecutor(selected); }}
        title={t('agentDesktop.localExecutor')}
        hint={t('agentDesktop.localExecutorHint')}
      />
      {settings?.enabled ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t('agentDesktop.executors')}</p>
          {settings.executors.length ? (
            <div className="flex flex-wrap gap-2">
              {settings.executors.map(executor => (
                <Chip key={executor.executorId} size="sm" variant="soft" color="success">{executor.deviceName}</Chip>
              ))}
            </div>
          ) : <p className="text-muted text-xs">{t('agentDesktop.noExecutors')}</p>}
        </div>
      ) : null}
      {settings?.enabled ? (
        <ComputerUseSettings
          settings={settings}
          saving={saving}
          onEnable={selected => { void setComputerEnabled(selected); }}
          onRequestPermissions={() => { void requestComputerPermissions(); }}
        />
      ) : null}
      <div className="border-separator flex flex-col gap-3 border-t pt-4">
        <div>
          <p className="text-sm font-medium">{t('agentDesktop.partitions')}</p>
          <p className="text-muted text-xs">{t('agentDesktop.partitionsHint')}</p>
        </div>
        {workspace ? (
          <div className="flex items-end gap-2">
            <Select
              className="min-w-0 flex-1"
              placeholder={t('agentDesktop.partitionAuto')}
              value={currentPartition ?? null}
              onChange={value => { if (typeof value === 'string' && value) void assign(value); }}
            >
              <Label>{t('agentDesktop.partitionForWorkspace', { workspace: workspace.name })}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {partitions.partitions.map(partition => (
                    <ListBox.Item key={partition.id} id={partition.id} textValue={partition.name}>
                      {partition.name}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
              <Description>{t('agentDesktop.partitionSwitchHint')}</Description>
            </Select>
            <Button size="sm" variant="secondary" onPress={() => { void create(); }}>
              <RiAddLine className="size-4" />
              {t('agentDesktop.partitionNew')}
            </Button>
          </div>
        ) : null}
        {partitions.partitions.length ? (
          <div className="flex flex-col gap-1">
            {partitions.partitions.map(partition => {
              const used = workspaceNames(partition.id);
              return (
                <div key={partition.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {partition.name}
                    <span className="text-muted ml-2 text-xs">{used.length ? used.join(', ') : t('agentDesktop.partitionUnused')}</span>
                  </span>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={t('agentDesktop.partitionDelete')} onPress={() => { void remove(partition.id, partition.name); }}>
                    <RiDeleteBinLine className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : <p className="text-muted text-xs">{t('agentDesktop.partitionNone')}</p>}
      </div>
    </Surface>
  );
}

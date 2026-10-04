import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Description, Label, ListBox, Select, Surface, Switch, toast } from '@heroui/react';
import { RiAddLine, RiDeleteBinLine } from '@remixicon/react';
import type { AgentDesktopSettings as Settings } from '@todex/protocol/agentDesktop';
import { ConnectionError } from '@todex/protocol/connectionError';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { V2ApiClient } from '@todex/protocol/v2';
import type { AgentBrowserPartitionState, ComputerPermissions } from '../../preload/index';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';

/** Store keys read by the main process (`agentDesktop/profiles.ts`). */
const EXECUTOR_ENABLED_KEY = 'todex.desktop.agentDesktopExecutor.v1';
const COMPUTER_ENABLED_KEY = 'todex.desktop.computerUse.v1';

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
  const [computerLocal, setComputerLocal] = useState(false);
  const [permissions, setPermissions] = useState<ComputerPermissions | null>(null);
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
    void desktop.store.get(COMPUTER_ENABLED_KEY).then(value => setComputerLocal(value === true));
    void desktop.computer.permissions().then(setPermissions);
    void desktop.agentBrowser.partitions().then(setPartitions);
    // Executors come and go; keep the list current while settings are open.
    const timer = setInterval(() => {
      void refresh();
      // Granted in System Settings, outside the app.
      void desktop.computer.permissions().then(setPermissions);
    }, 5000);
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

  const setComputerLocalEnabled = async (enabled: boolean) => {
    setComputerLocal(enabled);
    await desktop.store.set(COMPUTER_ENABLED_KEY, enabled);
    if (enabled) setPermissions(await desktop.computer.requestPermissions());
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
        <div className="border-separator flex flex-col gap-3 border-t pt-4">
          <p className="text-sm font-medium">{t('computerSettings.title')}</p>
          <SettingSwitch
            selected={settings.computerEnabled}
            disabled={saving}
            onChange={selected => { void setComputerEnabled(selected); }}
            title={t('computerSettings.enable')}
            hint={t('computerSettings.enableHint')}
          />
          {permissions && !permissions.supported ? (
            <p className="text-muted text-xs">{t('computerSettings.unsupported')}</p>
          ) : (
            <>
              <SettingSwitch
                selected={computerLocal}
                onChange={selected => { void setComputerLocalEnabled(selected); }}
                title={t('computerSettings.local')}
                hint={t('computerSettings.localHint')}
              />
              {computerLocal && permissions ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Chip size="sm" variant="soft" color={permissions.screen === 'granted' ? 'success' : 'warning'}>
                    {t(permissions.screen === 'granted' ? 'computerSettings.screenOk' : 'computerSettings.screenMissing')}
                  </Chip>
                  <Chip size="sm" variant="soft" color={permissions.accessibility ? 'success' : 'warning'}>
                    {t(permissions.accessibility ? 'computerSettings.axOk' : 'computerSettings.axMissing')}
                  </Chip>
                  {!permissions.helper ? <Chip size="sm" variant="soft" color="danger">{t('computerSettings.helperMissing')}</Chip> : null}
                  {permissions.screen !== 'granted' || !permissions.accessibility ? (
                    <Button size="sm" variant="secondary" onPress={() => { void desktop.computer.requestPermissions().then(setPermissions); }}>
                      {t('computerSettings.grant')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
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

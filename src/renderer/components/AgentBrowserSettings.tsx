import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Description, Label, ListBox, Select, toast } from '@heroui/react';
import { RiAddLine, RiDeleteBinLine, RiDownloadLine } from '@remixicon/react';
import type { AgentBrowserProfiles, AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import type { V2ApiClient } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';

/**
 * The agent browser on the backend's computer: its Chromium (download,
 * progress, problems) and the per-workspace browser profiles, which keep
 * cookies and storage apart and can be switched or deleted.
 */
export function AgentBrowserSettings({ session, api, settings, onSettings }: {
  session: TodeXSession;
  api: V2ApiClient;
  settings: AgentDesktopSettings;
  onSettings: (settings: AgentDesktopSettings) => void;
}) {
  const t = useT();
  const [profiles, setProfiles] = useState<AgentBrowserProfiles>({ profiles: [], workspaces: {} });
  const [busy, setBusy] = useState(false);
  const status = settings.browser;

  const reload = useCallback(async () => {
    try {
      setProfiles(await api.getAgentBrowserProfiles());
    } catch {
      // Older backends have no profiles route; the section explains below.
    }
  }, [api]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentDesktop.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="border-separator flex flex-col gap-1 border-t pt-4">
        <p className="text-sm font-medium">{t('agentBrowser.title')}</p>
        <p className="text-muted text-xs">{t('agentBrowser.legacyBackend')}</p>
      </div>
    );
  }
  const chromium = status.chromium;
  const workspace = session.activeWorkspace;
  const workspaceKey = workspace ? (workspace.id || workspace.path) : '';
  const current = workspaceKey ? profiles.workspaces[workspaceKey] : undefined;
  const usedBy = (profileId: string) => Object.entries(profiles.workspaces)
    .filter(([, id]) => id === profileId)
    .map(([key]) => session.workspaces.find(item => item.id === key || item.path === key)?.name || key.split(/[\\/]/).pop() || key);
  const progress = chromium.progress === undefined ? undefined : Math.round(chromium.progress * 100);

  return (
    <div className="border-separator flex flex-col gap-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">{t('agentBrowser.title')}</p>
        <p className="text-muted text-xs">{t('agentBrowser.settingsHint', { host: status.host })}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Chip size="sm" variant="soft" color={chromium.installed ? 'success' : 'warning'}>
          {chromium.installed
            ? t('agentBrowser.chromiumReady', { version: chromium.version })
            : chromium.downloading
              ? t('agentBrowser.chromiumDownloading', { progress: progress ?? 0 })
              : t('agentBrowser.chromiumMissing')}
        </Chip>
        {!chromium.installed && !chromium.downloading ? (
          <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run(async () => onSettings(await api.installAgentBrowser())); }}>
            <RiDownloadLine className="size-4" />
            {t('agentBrowser.install')}
          </Button>
        ) : null}
      </div>
      {chromium.error ? <p className="text-danger text-xs">{chromium.error}</p> : null}
      {status.reason && chromium.installed ? <p className="text-muted text-xs">{status.reason}</p> : null}
      {workspace ? (
        <div className="flex items-end gap-2">
          <Select
            className="min-w-0 flex-1"
            placeholder={t('agentDesktop.partitionAuto')}
            value={current ?? null}
            isDisabled={busy}
            onChange={value => {
              if (typeof value === 'string' && value) void run(async () => setProfiles(await api.assignAgentBrowserProfile(workspaceKey, value)));
            }}
          >
            <Label>{t('agentDesktop.partitionForWorkspace', { workspace: workspace.name })}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {profiles.profiles.map(profile => (
                  <ListBox.Item key={profile.id} id={profile.id} textValue={profile.name}>
                    {profile.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
            <Description>{t('agentDesktop.partitionSwitchHint')}</Description>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={busy}
            onPress={() => {
              void run(async () => {
                const created = await api.createAgentBrowserProfile(t('agentDesktop.partitionDefaultName', { n: profiles.profiles.length + 1 }));
                setProfiles(await api.assignAgentBrowserProfile(workspaceKey, created.id));
              });
            }}
          >
            <RiAddLine className="size-4" />
            {t('agentDesktop.partitionNew')}
          </Button>
        </div>
      ) : null}
      {profiles.profiles.length ? (
        <div className="flex flex-col gap-1">
          {profiles.profiles.map(profile => {
            const used = usedBy(profile.id);
            return (
              <div key={profile.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {profile.name}
                  <span className="text-muted ml-2 text-xs">{used.length ? used.join(', ') : t('agentDesktop.partitionUnused')}</span>
                </span>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  aria-label={t('agentDesktop.partitionDelete')}
                  onPress={() => {
                    if (!window.confirm(t('agentDesktop.partitionDeleteConfirm', { name: profile.name }))) return;
                    void run(async () => setProfiles(await api.deleteAgentBrowserProfile(profile.id)));
                  }}
                >
                  <RiDeleteBinLine className="size-4" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : <p className="text-muted text-xs">{t('agentDesktop.partitionNone')}</p>}
    </div>
  );
}

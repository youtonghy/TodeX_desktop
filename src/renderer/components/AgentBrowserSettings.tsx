import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Label, ListBox, ProgressBar, Select, Separator, toast } from '@heroui/react';
import { ItemCard, ItemCardGroup } from '@heroui-pro/react';
import { RiAddLine, RiDeleteBinLine, RiDownloadLine, RiFolder3Line, RiGlobalLine, RiUserLine } from '@remixicon/react';
import type { AgentBrowserProfiles, AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import type { V2ApiClient } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';

/**
 * The agent browser's settings page: its Chromium on the backend's computer
 * (download, progress, problems) and the per-workspace browser profiles,
 * which keep cookies and storage apart and can be switched or deleted.
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
      // Older backends have no profiles route; the page explains below.
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

  if (!status) return <p className="text-muted text-sm">{t('agentBrowser.legacyBackend')}</p>;
  const chromium = status.chromium;
  const workspace = session.activeWorkspace;
  const workspaceKey = workspace ? (workspace.id || workspace.path) : '';
  const current = workspaceKey ? profiles.workspaces[workspaceKey] : undefined;
  const usedBy = (profileId: string) => Object.entries(profiles.workspaces)
    .filter(([, id]) => id === profileId)
    .map(([key]) => session.workspaces.find(item => item.id === key || item.path === key)?.name || key.split(/[\\/]/).pop() || key);
  const progress = chromium.progress === undefined ? undefined : Math.round(chromium.progress * 100);

  return (
    <div className="flex flex-col gap-6">
      <ItemCardGroup variant="secondary">
        <ItemCardGroup.Header>
          <ItemCardGroup.Title>{t('agentBrowser.componentSection')}</ItemCardGroup.Title>
        </ItemCardGroup.Header>
        <ItemCard variant="transparent">
          <ItemCard.Icon><RiGlobalLine /></ItemCard.Icon>
          <ItemCard.Content>
            <ItemCard.Title>Chromium</ItemCard.Title>
            <ItemCard.Description>
              {chromium.installed
                ? t('agentBrowser.chromiumVersion', { version: chromium.version })
                : chromium.downloading
                  ? t('agentBrowser.chromiumDownloading', { progress: progress ?? 0 })
                  : t('agentBrowser.chromiumMissing')}
            </ItemCard.Description>
          </ItemCard.Content>
          <ItemCard.Action>
            {chromium.installed ? (
              <Chip size="sm" variant="soft" color="success">{t('agentDesktop.statusReady')}</Chip>
            ) : !chromium.downloading ? (
              <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => { void run(async () => onSettings(await api.installAgentBrowser())); }}>
                <RiDownloadLine className="size-4" />
                {t('agentBrowser.install')}
              </Button>
            ) : null}
          </ItemCard.Action>
        </ItemCard>
        {chromium.downloading ? (
          <ProgressBar aria-label={t('agentBrowser.chromiumDownloading', { progress: progress ?? 0 })} className="px-4 pb-4" size="sm" value={progress ?? 0} isIndeterminate={progress === undefined}>
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        ) : null}
        {chromium.error ? <p className="text-danger px-4 pb-4 text-xs">{chromium.error}</p> : null}
        {status.reason && chromium.installed ? <p className="text-muted px-4 pb-4 text-xs">{status.reason}</p> : null}
      </ItemCardGroup>

      {workspace ? (
        <ItemCardGroup variant="secondary">
          <ItemCardGroup.Header>
            <ItemCardGroup.Title>{t('agentBrowser.workspaceSection')}</ItemCardGroup.Title>
            <ItemCardGroup.Description>{t('agentDesktop.partitionSwitchHint')}</ItemCardGroup.Description>
          </ItemCardGroup.Header>
          <ItemCard variant="transparent">
            <ItemCard.Icon><RiFolder3Line /></ItemCard.Icon>
            <ItemCard.Content className="min-w-0">
              <ItemCard.Title>{workspace.name}</ItemCard.Title>
              {workspace.path && workspace.path !== workspace.name ? <ItemCard.Description className="w-full truncate" title={workspace.path}>{workspace.path}</ItemCard.Description> : null}
            </ItemCard.Content>
            <ItemCard.Action className="shrink-0">
              <Select
                aria-label={t('agentDesktop.partitionForWorkspace', { workspace: workspace.name })}
                className="w-40"
                placeholder={t('agentDesktop.partitionAuto')}
                value={current ?? null}
                isDisabled={busy}
                onChange={value => {
                  if (typeof value === 'string' && value) void run(async () => setProfiles(await api.assignAgentBrowserProfile(workspaceKey, value)));
                }}
              >
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
              </Select>
            </ItemCard.Action>
          </ItemCard>
        </ItemCardGroup>
      ) : null}

      <ItemCardGroup variant="secondary">
        <ItemCardGroup.Header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <ItemCardGroup.Title>{t('agentBrowser.profilesSection')}</ItemCardGroup.Title>
            <ItemCardGroup.Description>{t('agentBrowser.profilesHint')}</ItemCardGroup.Description>
          </div>
          {workspace ? (
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
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
          ) : null}
        </ItemCardGroup.Header>
        {profiles.profiles.length ? profiles.profiles.map((profile, index) => {
          const used = usedBy(profile.id);
          return (
            <div key={profile.id}>
              {index ? <Separator /> : null}
              <ItemCard variant="transparent">
                <ItemCard.Icon><RiUserLine /></ItemCard.Icon>
                <ItemCard.Content>
                  <ItemCard.Title className="flex items-center gap-2">
                    <span className="truncate">{profile.name}</span>
                    {profile.id === current ? <Chip size="sm" variant="soft" color="accent">{t('agentBrowser.profileCurrent')}</Chip> : null}
                  </ItemCard.Title>
                  <ItemCard.Description>{used.length ? used.join(', ') : t('agentDesktop.partitionUnused')}</ItemCard.Description>
                </ItemCard.Content>
                <ItemCard.Action>
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
                </ItemCard.Action>
              </ItemCard>
            </div>
          );
        }) : <p className="text-muted px-4 pb-4 text-sm">{t('agentDesktop.partitionNone')}</p>}
      </ItemCardGroup>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiDownloadLine, RiFolder3Line, RiGlobalLine, RiUserLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import type { AgentBrowserProfiles, AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import type { V2ApiClient } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from './settings/SettingsRows';
import { IconAction } from './ui/icon-action';
import { ProgressBar } from './ui/progress-bar';
import { toast } from './ui/toast';

/**
 * The agent browser's settings page: its Chromium on the backend's computer
 * (download, progress, problems) and the per-workspace browser profiles,
 * which keep cookies and storage apart and can be switched or deleted.
 */
export function AgentBrowserSettings({ session, backendId, api, settings, onSettings }: {
  session: TodeXSession;
  /** Backend these settings live on. */
  backendId: string;
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

  if (!status) return <p className="text-body-regular text-text-secondary">{t('agentBrowser.legacyBackend')}</p>;
  const chromium = status.chromium;
  // The open workspace counts only when it lives on that backend.
  const workspace = backendId === session.activeBackendConnectionId ? session.activeWorkspace : null;
  const workspaceKey = workspace ? (workspace.id || workspace.path) : '';
  const current = workspaceKey ? profiles.workspaces[workspaceKey] : undefined;
  const usedBy = (profileId: string) => Object.entries(profiles.workspaces)
    .filter(([, id]) => id === profileId)
    .map(([key]) => session.workspaces.find(item => item.id === key || item.path === key)?.name || key.split(/[\\/]/).pop() || key);
  const progress = chromium.progress === undefined ? undefined : Math.round(chromium.progress * 100);

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup label={t('agentBrowser.componentSection')}>
        <SettingsCard>
          <SettingsRow
            icon={RiGlobalLine}
            label="Chromium"
            description={chromium.installed
              ? t('agentBrowser.chromiumVersion', { version: chromium.version })
              : chromium.downloading
                ? t('agentBrowser.chromiumDownloading', { progress: progress ?? 0 })
                : t('agentBrowser.chromiumMissing')}
          >
            {chromium.installed ? (
              <Chip variant="caption" color="lime">{t('agentDesktop.statusReady')}</Chip>
            ) : !chromium.downloading ? (
              <Button size="small" variant="secondary" leadingIcon={RiDownloadLine} disabled={busy} onClick={() => { void run(async () => onSettings(await api.installAgentBrowser())); }}>
                {t('agentBrowser.install')}
              </Button>
            ) : null}
          </SettingsRow>
          {chromium.downloading ? (
            <SettingsNote>
              <ProgressBar aria-label={t('agentBrowser.chromiumDownloading', { progress: progress ?? 0 })} showValue={false} value={progress} />
            </SettingsNote>
          ) : null}
          {chromium.error ? <SettingsNote tone="danger">{chromium.error}</SettingsNote> : null}
          {status.reason && chromium.installed ? <SettingsNote>{status.reason}</SettingsNote> : null}
        </SettingsCard>
      </SettingsGroup>

      {workspace ? (
        <SettingsGroup label={t('agentBrowser.workspaceSection')} description={t('agentDesktop.partitionSwitchHint')}>
          <SettingsCard>
            <SettingsRow
              icon={RiFolder3Line}
              label={workspace.name}
              description={workspace.path && workspace.path !== workspace.name ? <span className="block truncate" title={workspace.path}>{workspace.path}</span> : undefined}
            >
              <Select
                aria-label={t('agentDesktop.partitionForWorkspace', { workspace: workspace.name })}
                className="w-40"
                triggerClassName="h-8 rounded-lg px-2 py-1.5"
                placeholder={t('agentDesktop.partitionAuto')}
                selectedKey={current ?? null}
                isDisabled={busy}
                onSelectionChange={value => {
                  if (typeof value === 'string' && value) void run(async () => setProfiles(await api.assignAgentBrowserProfile(workspaceKey, value)));
                }}
              >
                {profiles.profiles.map(profile => (
                  <SelectItem key={profile.id} id={profile.id} textValue={profile.name}>{profile.name}</SelectItem>
                ))}
              </Select>
            </SettingsRow>
          </SettingsCard>
        </SettingsGroup>
      ) : null}

      <SettingsGroup
        label={t('agentBrowser.profilesSection')}
        description={t('agentBrowser.profilesHint')}
        action={workspace ? (
          <Button
            size="small"
            variant="secondary"
            leadingIcon={RiAddLine}
            disabled={busy}
            onClick={() => {
              void run(async () => {
                const created = await api.createAgentBrowserProfile(t('agentDesktop.partitionDefaultName', { n: profiles.profiles.length + 1 }));
                setProfiles(await api.assignAgentBrowserProfile(workspaceKey, created.id));
              });
            }}
          >
            {t('agentDesktop.partitionNew')}
          </Button>
        ) : undefined}
      >
        <SettingsCard>
          {profiles.profiles.length ? profiles.profiles.map(profile => {
            const used = usedBy(profile.id);
            return (
              <SettingsRow
                key={profile.id}
                icon={RiUserLine}
                label={(
                  <span className="flex items-center gap-2">
                    <span className="truncate">{profile.name}</span>
                    {profile.id === current ? <Chip variant="caption" color="blue">{t('agentBrowser.profileCurrent')}</Chip> : null}
                  </span>
                )}
                description={used.length ? used.join(', ') : t('agentDesktop.partitionUnused')}
              >
                <IconAction
                  icon={RiDeleteBinLine}
                  size="sm"
                  disabled={busy}
                  aria-label={t('agentDesktop.partitionDelete')}
                  onClick={() => {
                    if (!window.confirm(t('agentDesktop.partitionDeleteConfirm', { name: profile.name }))) return;
                    void run(async () => setProfiles(await api.deleteAgentBrowserProfile(profile.id)));
                  }}
                />
              </SettingsRow>
            );
          }) : <SettingsNote className="py-3 text-body-regular">{t('agentDesktop.partitionNone')}</SettingsNote>}
        </SettingsCard>
      </SettingsGroup>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiDownloadLine, RiFolder3Line, RiGlobalLine, RiLink, RiUserLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import type { AgentBrowserEngine, AgentBrowserInstall, AgentBrowserProfiles, AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import type { V2ApiClient } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from './settings/SettingsRows';
import { LiveViewPlacementSetting } from './LiveViewPlacementSetting';
import { IconAction } from './ui/icon-action';
import { ProgressBar } from './ui/progress-bar';
import { toast } from './ui/toast-store';

const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';
const ENGINES: AgentBrowserEngine[] = ['chromium', 'kitesurf'];
const ENGINE_LABELS = { chromium: 'agentBrowser.engineChromium', kitesurf: 'agentBrowser.engineKitesurf' } as const;

/**
 * The agent browser's settings page: its engine on the backend's computer
 * (Chromium, or the experimental Kitesurf; download, progress, problems), the
 * per-workspace browser profiles Chromium uses, which keep cookies and storage
 * apart and can be switched or deleted, and the hosts beyond that computer
 * the user always allows agents to open, which can be removed.
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
  // `null`: the backend has no host list (older backends open local pages only).
  const [hosts, setHosts] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const status = settings.browser;

  const reload = useCallback(async () => {
    try {
      setProfiles(await api.getAgentBrowserProfiles());
    } catch {
      // Older backends have no profiles route; the page explains below.
    }
    try {
      setHosts((await api.getAgentBrowserHosts()).hosts);
    } catch {
      setHosts(null);
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
  // Backends without `engine` run Chromium only.
  const engine = status.engine ?? 'chromium';
  const kitesurf = engine === 'kitesurf' ? status.engines?.kitesurf : undefined;
  // The open workspace counts only when it lives on that backend.
  const workspace = backendId === session.activeBackendConnectionId ? session.activeWorkspace : null;
  const workspaceKey = workspace ? (workspace.id || workspace.path) : '';
  const current = workspaceKey ? profiles.workspaces[workspaceKey] : undefined;
  const usedBy = (profileId: string) => Object.entries(profiles.workspaces)
    .filter(([, id]) => id === profileId)
    .map(([key]) => session.workspaces.find(item => item.id === key || item.path === key)?.name || key.split(/[\\/]/).pop() || key);
  const install = () => { void run(async () => onSettings(await api.installAgentBrowser())); };

  return (
    <div className="flex flex-col gap-6">
      <LiveViewPlacementSetting tool="browser" />
      <SettingsGroup label={t('agentBrowser.componentSection')}>
        <SettingsCard>
          {status.engine ? (
            <SettingsRow label={t('agentBrowser.engine')} description={t('agentBrowser.engineHint', { host: status.host })}>
              <Select
                aria-label={t('agentBrowser.engine')}
                selectedKey={engine}
                isDisabled={busy}
                triggerClassName={ROW_SELECT_TRIGGER}
                onSelectionChange={value => {
                  if (ENGINES.includes(value as AgentBrowserEngine) && value !== engine) {
                    void run(async () => onSettings(await api.setAgentBrowserEngine(value as AgentBrowserEngine)));
                  }
                }}
              >
                {ENGINES.map(id => <SelectItem key={id} id={id} textValue={t(ENGINE_LABELS[id])}>{t(ENGINE_LABELS[id])}</SelectItem>)}
              </Select>
            </SettingsRow>
          ) : null}
          {kitesurf ? (
            <>
              <SettingsNote>{t('agentBrowser.kitesurfHint')}</SettingsNote>
              {kitesurf.supported ? (
                <EngineInstallRow
                  name="Kitesurf"
                  install={kitesurf}
                  busy={busy}
                  downloading={t('agentBrowser.kitesurfDownloading', { progress: percent(kitesurf) })}
                  missing={t('agentBrowser.kitesurfMissing')}
                  onInstall={install}
                />
              ) : null}
              {kitesurf.error ? <SettingsNote tone="danger">{kitesurf.error}</SettingsNote> : null}
              {status.reason && (kitesurf.installed || !kitesurf.supported) ? <SettingsNote>{status.reason}</SettingsNote> : null}
            </>
          ) : (
            <>
              <EngineInstallRow
                name="Chromium"
                install={status.chromium}
                busy={busy}
                downloading={t('agentBrowser.chromiumDownloading', { progress: percent(status.chromium) })}
                missing={t('agentBrowser.chromiumMissing')}
                onInstall={install}
              />
              {status.chromium.error ? <SettingsNote tone="danger">{status.chromium.error}</SettingsNote> : null}
              {status.reason && status.chromium.installed ? <SettingsNote>{status.reason}</SettingsNote> : null}
            </>
          )}
        </SettingsCard>
      </SettingsGroup>

      {/* Kitesurf keeps nothing between tabs: no workspace profile applies. */}
      {workspace && !kitesurf ? (
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
        description={t(kitesurf ? 'agentBrowser.kitesurfProfilesHint' : 'agentBrowser.profilesHint')}
        action={workspace && !kitesurf ? (
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

      {hosts ? (
        <SettingsGroup label={t('agentBrowser.hostsSection')} description={t('agentBrowser.hostsHint')}>
          <SettingsCard>
            {hosts.length ? hosts.map(host => (
              <SettingsRow key={host} icon={RiLink} label={<bdi dir="ltr" className="truncate">{host}</bdi>}>
                <IconAction
                  icon={RiDeleteBinLine}
                  size="sm"
                  disabled={busy}
                  aria-label={t('agentBrowser.hostRemove', { host })}
                  onClick={() => { void run(async () => setHosts((await api.removeAgentBrowserHost(host)).hosts)); }}
                />
              </SettingsRow>
            )) : <SettingsNote className="py-3 text-body-regular">{t('agentBrowser.hostsNone')}</SettingsNote>}
          </SettingsCard>
        </SettingsGroup>
      ) : null}
    </div>
  );
}

function percent(install: AgentBrowserInstall) {
  return Math.round((install.progress ?? 0) * 100);
}

/** One engine's install on the backend's computer: version, download and its progress. */
function EngineInstallRow({ name, install, busy, downloading, missing, onInstall }: {
  name: string;
  install: AgentBrowserInstall;
  busy: boolean;
  /** Description while downloading. */
  downloading: string;
  /** Description while not installed. */
  missing: string;
  onInstall: () => void;
}) {
  const t = useT();
  return (
    <>
      <SettingsRow
        icon={RiGlobalLine}
        label={name}
        description={install.installed
          ? t('agentBrowser.chromiumVersion', { version: install.version })
          : install.downloading ? downloading : missing}
      >
        {install.installed ? (
          <Chip variant="caption" color="lime">{t('agentDesktop.statusReady')}</Chip>
        ) : !install.downloading ? (
          <Button size="small" variant="secondary" leadingIcon={RiDownloadLine} disabled={busy} onClick={onInstall}>
            {t('agentBrowser.install')}
          </Button>
        ) : null}
      </SettingsRow>
      {install.downloading ? (
        <SettingsNote>
          <ProgressBar aria-label={downloading} showValue={false} value={percent(install)} />
        </SettingsNote>
      ) : null}
    </>
  );
}

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { RiApps2Line, RiCodeBoxLine, RiComputerLine, RiGroupLine, RiHistoryLine, RiInformationLine, RiNotification3Line, RiPaletteLine, RiServerLine, RiSettings3Line, RiTeamLine, RiTerminalBoxLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { SettingsContent, SettingsNav, type SettingsNavGroup } from '@/components/application/settings/settings-modal';
import { AgentCallingSettings } from '../components/AgentCallingSettings';
import { AgentDesktopSettings, type AgentDesktopPage } from '../components/AgentDesktopSettings';
import { BackendConnectionSettings } from '../components/settings/BackendConnectionSettings';
import { MeshGroupSettings } from '../components/settings/MeshGroupSettings';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { TerminalSettings } from '../components/settings/TerminalSettings';
import { FeatureSettings } from '../components/FeatureSettings';
import { SettingsCard, SettingsEntry, SettingsGroup, SettingsRow, SettingsSubpage } from '../components/settings/SettingsRows';
import { SshConnectionSettings } from '../components/settings/SshConnectionSettings';
import { TodexHistoryCleanup } from '../components/cleanup/TodexHistoryCleanup';
import type { CliPage } from '../components/cli/CliAgentPage';
import { AboutPanel } from './AboutPanel';
import { CliManagerPanel } from './CliManagerPanel';
import { ScrollArea } from '../components/ui/scroll-area';
import { toast } from '../components/ui/toast';
import type { TodeXSession } from '../session/useTodeXSession';
import { platform } from '../platform';
import { historyTailCache } from '../session/historyCache';
import { HistoryCacheSettings } from '../components/settings/HistoryCacheSettings';
import { slots } from '../platform/slots';
import { LOCALE_LABELS, SUPPORTED_LOCALES, getLocalePreference, isLocale, setLocalePreference, useT, type LocalePreference } from '../i18n';

export type SettingsSection = 'general' | 'features' | 'appearance' | 'connection' | 'mesh' | 'local-backend' | 'container' | 'cli' | 'ssh' | 'notifications' | 'agent' | 'agent-calling' | 'about';
/** Show a category on open or while open; `at` makes a repeat request distinct. */
export type SettingsSectionRequest = { section: SettingsSection; at: number };

type Props = {
  session: TodeXSession;
  /** Start setting up a history recovery key (from the global notice). */
  historyRecoverySetup?: boolean;
  /** Start device pairing again (from a refused connection's re-pair action). */
  repairPairing?: boolean;
  sectionRequest?: SettingsSectionRequest;
};

/** Compact select trigger for the right side of a settings row. */
const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';

export function SettingsPanel({ session, historyRecoverySetup = false, repairPairing = false, sectionRequest }: Props) {
  const t = useT();
  const [languagePreference, setLanguagePreference] = useState<LocalePreference>(() => getLocalePreference());
  const [pairingAutoStart, setPairingAutoStart] = useState(0);
  // A tool's own settings page shown in place of everything else.
  const [agentPage, setAgentPage] = useState<AgentDesktopPage | null>(null);
  // The backend whose own page replaces the backend list.
  const [backendPage, setBackendPage] = useState<string | null>(null);
  // A CLI's own page (or the shared skills and MCPs) in place of the CLI list.
  const [cliPage, setCliPage] = useState<CliPage | null>(null);
  // TodeX's conversation history cleanup in place of the general page.
  const [historyPage, setHistoryPage] = useState(false);
  const [section, setSection] = useState<SettingsSection>(sectionRequest?.section ?? 'general');
  useEffect(() => {
    if (sectionRequest) setSection(sectionRequest.section);
  }, [sectionRequest]);
  // CLI management talks to the backend as soon as it mounts, so it waits
  // for its first visit instead of mounting with the other pages.
  const [cliVisited, setCliVisited] = useState(section === 'cli');
  useEffect(() => {
    if (section === 'cli') setCliVisited(true);
  }, [section]);
  // Host sections (local backend discovery, Docker checks) run CLI commands,
  // so they too wait for a visit.
  const [hostVisited, setHostVisited] = useState<ReadonlySet<SettingsSection>>(() => new Set([section]));
  useEffect(() => {
    setHostVisited((current) => (current.has(section) ? current : new Set([...current, section])));
  }, [section]);
  const agentPanel = useRef<HTMLDivElement>(null);
  const backendPanel = useRef<HTMLDivElement>(null);
  const cliPanel = useRef<HTMLDivElement>(null);
  const generalPanel = useRef<HTMLDivElement>(null);
  // Re-pairing and recovery-key setup both live on the page of the backend
  // that asked for them: the focused one when the request was made.
  const focusBackendIdRef = useRef(session.activeBackendConnectionId);
  focusBackendIdRef.current = session.activeBackendConnectionId;
  const [pairingRequested, setPairingRequested] = useState(false);
  useEffect(() => {
    if (!repairPairing && !historyRecoverySetup) return;
    setSection('connection');
    setBackendPage(focusBackendIdRef.current);
    if (repairPairing) setPairingRequested(true);
  }, [repairPairing, historyRecoverySetup]);
  // Pairing starts once that page (and its pairing panel) is mounted.
  useEffect(() => {
    if (!pairingRequested || !backendPage) return;
    setPairingRequested(false);
    setPairingAutoStart((value) => value + 1);
  }, [backendPage, pairingRequested]);
  // A tool or backend page opens at its top, not at the overview's scroll offset.
  useEffect(() => {
    if (agentPage) agentPanel.current?.scrollTo({ top: 0 });
  }, [agentPage]);
  useEffect(() => {
    backendPanel.current?.scrollTo({ top: 0 });
  }, [backendPage]);
  useEffect(() => {
    cliPanel.current?.scrollTo({ top: 0 });
  }, [cliPage]);
  useEffect(() => {
    generalPanel.current?.scrollTo({ top: 0 });
  }, [historyPage]);

  const groups: SettingsNavGroup<SettingsSection>[] = [
    { id: 'app', label: t('settings.groupApp'), items: [
      { id: 'general', label: t('settings.general'), icon: RiSettings3Line },
      { id: 'features', label: t('settings.features'), icon: RiApps2Line },
      { id: 'appearance', label: t('settings.appearance'), icon: RiPaletteLine },
      { id: 'notifications', label: t('settings.notifications'), icon: RiNotification3Line },
    ] },
    { id: 'connections', label: t('settings.groupConnections'), items: [
      { id: 'connection', label: t('settings.backendConnections'), icon: RiServerLine },
      ...(platform.deployment ? [] : [{ id: 'mesh' as const, label: t('mesh.title'), icon: RiGroupLine }]),
      ...slots.settingsSections.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })),
      { id: 'ssh', label: t('settings.ssh'), icon: RiTerminalBoxLine },
    ] },
    { id: 'agents', label: t('settings.groupAgents'), items: [
      { id: 'cli', label: t('app.cliManager'), icon: RiCodeBoxLine },
      { id: 'agent', label: t('agentDesktop.title'), icon: RiComputerLine },
      { id: 'agent-calling', label: t('agentCalling.title'), icon: RiTeamLine },
    ] },
    { id: 'todex', label: t('settings.groupTodex'), items: [
      { id: 'about', label: t('app.about'), icon: RiInformationLine },
    ] },
  ];
  const titleOf = (id: SettingsSection) => groups.flatMap((group) => group.items).find((item) => item.id === id)?.label ?? '';
  const page = (id: SettingsSection) => ({ title: titleOf(id), isActive: id === section });

  // Grouped categories on the left, each one's page on the right. Inactive
  // pages stay mounted (hidden), so an in-progress pairing or recovery-key
  // setup survives a visit to another category.
  return (
    <div className="flex min-h-0 flex-1">
      <SettingsNav aria-label={t('app.settings')} groups={groups} selected={section} onSelect={setSection} />
      <SettingsContent title={titleOf(section)}>
        <SettingsPage {...page('general')} viewportRef={generalPanel}>
          {historyPage ? (
            <SettingsSubpage title={t('cleanup.todexTitle')} onBack={() => setHistoryPage(false)}>
              <TodexHistoryCleanup session={session} />
            </SettingsSubpage>
          ) : <>
          <SettingsCard>
            <SettingsRow label={t('common.language')} description={t('settings.languageHint')}>
              <Select
                aria-label={t('common.language')}
                selectedKey={languagePreference}
                triggerClassName={ROW_SELECT_TRIGGER}
                onSelectionChange={(value) => {
                  if (value === 'auto' || isLocale(value)) {
                    const preference = value as LocalePreference;
                    setLanguagePreference(preference);
                    setLocalePreference(preference);
                  }
                }}
              >
                <SelectItem id="auto" textValue={t('common.language.auto')}>{t('common.language.auto')}</SelectItem>
                {SUPPORTED_LOCALES.map((locale) => (
                  <SelectItem key={locale} id={locale} textValue={LOCALE_LABELS[locale]}>{LOCALE_LABELS[locale]}</SelectItem>
                ))}
              </Select>
            </SettingsRow>
          </SettingsCard>
          <SettingsGroup label={t('settings.aside')}>
            <SettingsCard>
              <SettingsRow
                label={t('settings.asideSharing')}
                description={session.workbenchSharing === 'workspace' ? t('settings.shareWorkspaceHint') : t('settings.shareConversationHint')}
              >
                <Select
                  aria-label={t('settings.asideSharing')}
                  selectedKey={session.workbenchSharing}
                  isDisabled={!session.workbenchSharingHydrated}
                  triggerClassName={ROW_SELECT_TRIGGER}
                  onSelectionChange={(value) => {
                    if (value === 'conversation' || value === 'workspace') session.setWorkbenchSharing(value);
                  }}
                >
                  <SelectItem id="conversation" textValue={t('settings.shareConversation')}>{t('settings.shareConversation')}</SelectItem>
                  <SelectItem id="workspace" textValue={t('settings.shareWorkspace')}>{t('settings.shareWorkspace')}</SelectItem>
                </Select>
              </SettingsRow>
            </SettingsCard>
          </SettingsGroup>
          <SettingsGroup label={t('settings.storage')}>
            <SettingsCard className="overflow-hidden ps-0">
              <SettingsEntry icon={RiHistoryLine} title={t('cleanup.todexTitle')} description={t('settings.todexHistoryEntry')} onPress={() => setHistoryPage(true)} />
            </SettingsCard>
            {historyTailCache ? (
              <SettingsCard>
                <HistoryCacheSettings cache={historyTailCache} />
              </SettingsCard>
            ) : null}
          </SettingsGroup>
          </>}
        </SettingsPage>

        <SettingsPage {...page('features')}>
          <FeatureSettings />
        </SettingsPage>

        <SettingsPage {...page('appearance')}>
          <AppearanceSettings />
          <TerminalSettings />
        </SettingsPage>

        <SettingsPage {...page('connection')} viewportRef={backendPanel}>
          <BackendConnectionSettings
            session={session}
            page={backendPage}
            onPageChange={setBackendPage}
            deviceName={platform.productName}
            pairingAutoStart={pairingAutoStart}
            historyRecoverySetup={historyRecoverySetup}
            managed={Boolean(platform.deployment)}
            footer={platform.clearLocalData ? <ClearLocalData session={session} clear={platform.clearLocalData} /> : undefined}
          />
        </SettingsPage>

        {platform.deployment ? null : (
          <SettingsPage {...page('mesh')}>
            <MeshGroupSettings session={session} />
          </SettingsPage>
        )}

        {slots.settingsSections.map(({ id, Component }) => (hostVisited.has(id) ? (
          <SettingsPage key={id} {...page(id)}>
            <Component session={session} deviceName={platform.productName} />
          </SettingsPage>
        ) : null))}

        <SettingsPage {...page('cli')} viewportRef={cliPanel}>
          {cliVisited ? <CliManagerPanel session={session} page={cliPage} onPageChange={setCliPage} /> : null}
        </SettingsPage>

        <SettingsPage {...page('ssh')}>
          <SshConnectionSettings session={session} />
        </SettingsPage>

        <SettingsPage {...page('notifications')}>
          <SettingsCard>
            <SettingsRow
              label={t('settings.notifyTaskDone')}
              description={session.completionNotificationsSupported ? t('settings.notifyTaskDoneHint') : t('settings.notifyUnsupported')}
            >
              <Switch
                size="sm"
                aria-label={t('settings.notifyTaskDone')}
                isSelected={session.completionNotifications}
                isDisabled={!session.completionNotificationsHydrated}
                onChange={(selected) => {
                  void session.setCompletionNotifications(selected).then((result) => {
                    if (result === 'denied') toast.danger(t('settings.notifyDenied'));
                    if (result === 'unsupported') toast.danger(t('settings.notifyUnsupported'));
                  });
                }}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsPage>

        <SettingsPage {...page('agent')} viewportRef={agentPanel}>
          <AgentDesktopSettings session={session} page={agentPage} onPageChange={setAgentPage} />
        </SettingsPage>

        <SettingsPage {...page('agent-calling')}>
          <AgentCallingSettings session={session} />
        </SettingsPage>

        <SettingsPage {...page('about')}>
          <AboutPanel session={session} />
        </SettingsPage>
      </SettingsContent>
    </div>
  );
}

/** One category's page, scrolling under the shared title row; hidden while another is shown. */
function SettingsPage({ title, isActive, viewportRef, children }: { title: string; isActive: boolean; viewportRef?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <section aria-label={title} hidden={!isActive} className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" contentClassName="px-8 pb-8" surface="full" viewportRef={viewportRef}>
        <div className="flex flex-col gap-6 pt-1">{children}</div>
      </ScrollArea>
    </section>
  );
}

/** Web: forgets every key and secret this browser stored, then reloads. */
function ClearLocalData({ session, clear }: { session: TodeXSession; clear: () => Promise<void> }) {
  const t = useT();
  return (
    <SettingsCard>
      <SettingsRow label={t('settings.localData')} description={t('settings.localDataHint')}>
        <Button
          size="small"
          variant="danger"
          onClick={() => {
            if (!window.confirm(t('settings.localDataConfirm'))) return;
            for (const profile of session.backendConnections) session.disconnect(profile.id);
            void clear().catch((error: unknown) => {
              toast.danger(error instanceof Error ? error.message : t('history.keyFailed'));
            }).finally(() => window.location.reload());
          }}
        >
          {t('settings.localDataClear')}
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}

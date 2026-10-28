import { useEffect, useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { RiApps2Line, RiCodeBoxLine, RiComputerLine, RiHistoryLine, RiInformationLine, RiNotification3Line, RiPaletteLine, RiServerLine, RiSettings3Line, RiTeamLine, RiTerminalBoxLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { cx } from '@/utils/cx';
import { AgentCallingSettings } from '../components/AgentCallingSettings';
import { AgentDesktopSettings, type AgentDesktopPage } from '../components/AgentDesktopSettings';
import { BackendConnectionSettings } from '../components/settings/BackendConnectionSettings';
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
import { slots } from '../platform/slots';
import { LOCALE_LABELS, SUPPORTED_LOCALES, getLocalePreference, isLocale, setLocalePreference, useT, type LocalePreference } from '../i18n';

export type SettingsSection = 'general' | 'features' | 'appearance' | 'connection' | 'local-backend' | 'container' | 'cli' | 'ssh' | 'notifications' | 'agent' | 'agent-calling' | 'about';
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

  const sections: Array<{ id: SettingsSection; label: string; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> }> = [
    { id: 'general', label: t('settings.general'), icon: RiSettings3Line },
    { id: 'features', label: t('settings.features'), icon: RiApps2Line },
    { id: 'appearance', label: t('settings.appearance'), icon: RiPaletteLine },
    { id: 'connection', label: t('settings.backendConnections'), icon: RiServerLine },
    ...slots.settingsSections.map((item) => ({ id: item.id, label: t(item.labelKey), icon: item.icon })),
    { id: 'cli', label: t('app.cliManager'), icon: RiCodeBoxLine },
    { id: 'ssh', label: t('settings.ssh'), icon: RiTerminalBoxLine },
    { id: 'notifications', label: t('settings.notifications'), icon: RiNotification3Line },
    { id: 'agent', label: t('agentDesktop.title'), icon: RiComputerLine },
    { id: 'agent-calling', label: t('agentCalling.title'), icon: RiTeamLine },
    { id: 'about', label: t('app.about'), icon: RiInformationLine },
  ];
  const titleOf = (id: SettingsSection) => sections.find((item) => item.id === id)?.label ?? '';

  // Categories on the left, each one's page on the right. Inactive pages stay
  // mounted (hidden), so an in-progress pairing or recovery-key setup
  // survives a visit to another category.
  return (
    <Tabs
      orientation="vertical"
      className="flex h-full min-h-0 flex-1"
      selectedKey={section}
      onSelectionChange={(key) => setSection(key as SettingsSection)}
    >
      <div className="flex w-14 shrink-0 flex-col overflow-y-auto border-e border-t border-separator-border bg-background-secondary-default p-2.5 sm:w-48 lg:w-60">
        <TabList aria-label={t('app.settings')} className="flex w-full flex-col gap-1 pt-1">
          {sections.map(({ id, label, icon: Icon }) => (
            <Tab
              key={id}
              id={id}
              aria-label={label}
              className={({ isSelected, isFocusVisible }) => cx(
                'flex w-full cursor-pointer items-center gap-2 rounded-2lg p-2 text-start outline-none transition-colors duration-150 ease',
                isSelected ? 'bg-background-secondary-hover text-text-primary' : 'text-text-secondary hover:bg-background-secondary-hover/60',
                isFocusVisible && 'ring-2 ring-border-focus-ring',
              )}
            >
              <Icon aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" />
              <span className="hidden truncate text-body-medium sm:block">{label}</span>
            </Tab>
          ))}
        </TabList>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <SettingsPage id="general" title={titleOf('general')} viewportRef={generalPanel}>
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
          </SettingsGroup>
          </>}
        </SettingsPage>

        <SettingsPage id="features" title={titleOf('features')}>
          <FeatureSettings />
        </SettingsPage>

        <SettingsPage id="appearance" title={titleOf('appearance')}>
          <AppearanceSettings />
          <TerminalSettings />
        </SettingsPage>

        <SettingsPage id="connection" title={titleOf('connection')} viewportRef={backendPanel}>
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

        {slots.settingsSections.map(({ id, Component }) => (hostVisited.has(id) ? (
          <SettingsPage key={id} id={id} title={titleOf(id)}>
            <Component session={session} deviceName={platform.productName} />
          </SettingsPage>
        ) : null))}

        <SettingsPage id="cli" title={titleOf('cli')} viewportRef={cliPanel}>
          {cliVisited ? <CliManagerPanel session={session} page={cliPage} onPageChange={setCliPage} /> : null}
        </SettingsPage>

        <SettingsPage id="ssh" title={titleOf('ssh')}>
          <SshConnectionSettings session={session} />
        </SettingsPage>

        <SettingsPage id="notifications" title={titleOf('notifications')}>
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

        <SettingsPage id="agent" title={titleOf('agent')} viewportRef={agentPanel}>
          <AgentDesktopSettings session={session} page={agentPage} onPageChange={setAgentPage} />
        </SettingsPage>

        <SettingsPage id="agent-calling" title={titleOf('agent-calling')}>
          <AgentCallingSettings session={session} />
        </SettingsPage>

        <SettingsPage id="about" title={titleOf('about')}>
          <AboutPanel session={session} />
        </SettingsPage>
      </div>
    </Tabs>
  );
}

/** One category's page: a fixed title over its own scroll region. */
function SettingsPage({ id, title, viewportRef, children }: { id: SettingsSection; title: string; viewportRef?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <TabPanel id={id} shouldForceMount className="flex min-h-0 flex-1 flex-col outline-none data-[inert=true]:hidden">
      <h2 className="shrink-0 px-8 pt-6 pb-3 text-title-3-medium text-text-primary">{title}</h2>
      <ScrollArea className="flex-1" contentClassName="px-8 pb-8" surface="full" viewportRef={viewportRef}>
        <div className="flex flex-col gap-6 pt-1">{children}</div>
      </ScrollArea>
    </TabPanel>
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

import { useEffect, useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { RiApps2Line, RiComputerLine, RiNotification3Line, RiPaletteLine, RiServerLine, RiSettings3Line, RiTerminalBoxLine } from '@remixicon/react';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { cx } from '@/utils/cx';
import { AgentDesktopSettings, type AgentDesktopPage } from '../components/AgentDesktopSettings';
import { BackendConnectionSettings } from '../components/settings/BackendConnectionSettings';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { FeatureSettings } from '../components/FeatureSettings';
import { SettingsCard, SettingsGroup, SettingsRow } from '../components/settings/SettingsRows';
import { SshConnectionSettings } from '../components/settings/SshConnectionSettings';
import { ScrollArea } from '../components/ui/scroll-area';
import { toast } from '../components/ui/toast';
import type { TodeXSession } from '../session/useTodeXSession';
import { LOCALE_LABELS, SUPPORTED_LOCALES, getLocalePreference, isLocale, setLocalePreference, useT, type LocalePreference } from '../i18n';

type SettingsSection = 'general' | 'features' | 'appearance' | 'connection' | 'ssh' | 'notifications' | 'agent';

type Props = {
  session: TodeXSession;
  /** Start setting up a history recovery key (from the global notice). */
  historyRecoverySetup?: boolean;
  /** Start device pairing again (from a refused connection's re-pair action). */
  repairPairing?: boolean;
};

/** Compact select trigger for the right side of a settings row. */
const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';

export function SettingsPanel({ session, historyRecoverySetup = false, repairPairing = false }: Props) {
  const t = useT();
  const [languagePreference, setLanguagePreference] = useState<LocalePreference>(() => getLocalePreference());
  const [pairingAutoStart, setPairingAutoStart] = useState(0);
  // A tool's own settings page shown in place of everything else.
  const [agentPage, setAgentPage] = useState<AgentDesktopPage | null>(null);
  // The backend whose own page replaces the backend list.
  const [backendPage, setBackendPage] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSection>('general');
  const agentPanel = useRef<HTMLDivElement>(null);
  const backendPanel = useRef<HTMLDivElement>(null);
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

  const sections: Array<{ id: SettingsSection; label: string; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> }> = [
    { id: 'general', label: t('settings.general'), icon: RiSettings3Line },
    { id: 'features', label: t('settings.features'), icon: RiApps2Line },
    { id: 'appearance', label: t('settings.appearance'), icon: RiPaletteLine },
    { id: 'connection', label: t('settings.backendConnections'), icon: RiServerLine },
    { id: 'ssh', label: t('settings.ssh'), icon: RiTerminalBoxLine },
    { id: 'notifications', label: t('settings.notifications'), icon: RiNotification3Line },
    { id: 'agent', label: t('agentDesktop.title'), icon: RiComputerLine },
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
        <SettingsPage id="general" title={titleOf('general')}>
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
        </SettingsPage>

        <SettingsPage id="features" title={titleOf('features')}>
          <FeatureSettings />
        </SettingsPage>

        <SettingsPage id="appearance" title={titleOf('appearance')}>
          <AppearanceSettings />
        </SettingsPage>

        <SettingsPage id="connection" title={titleOf('connection')} viewportRef={backendPanel}>
          <BackendConnectionSettings
            session={session}
            page={backendPage}
            onPageChange={setBackendPage}
            deviceName="TodeX Desktop"
            pairingAutoStart={pairingAutoStart}
            historyRecoverySetup={historyRecoverySetup}
          />
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

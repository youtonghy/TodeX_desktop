import { useEffect, useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import { Radio, RadioGroup, Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { RiApps2Line, RiComputerLine, RiNotification3Line, RiPaletteLine, RiServerLine, RiSettings3Line, RiShieldKeyholeLine } from '@remixicon/react';
import { normalizeServerUrl } from '@todex/protocol/todex';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Label } from '@/components/base/input/label';
import { RadioCard } from '@/components/base/radio/radio-card';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { cx } from '@/utils/cx';
import { BACKEND_LABEL_COLORS, backendLabelColor } from '../session/backendColors';
import { DevicePairingPanel } from '../components/DevicePairingPanel';
import { HistoryEncryptionPanel } from '../components/HistoryEncryptionPanel';
import { AgentDesktopSettings, type AgentDesktopPage } from '../components/AgentDesktopSettings';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { FeatureSettings } from '../components/FeatureSettings';
import { SettingsCard, SettingsGroup, SettingsRow } from '../components/settings/SettingsRows';
import { ScrollArea } from '../components/ui/scroll-area';
import { toast } from '../components/ui/toast';
import type { TodeXSession } from '../session/useTodeXSession';
import { UNPAIRED_TRANSPORT, connectionStateLabel, healthLabelOf, settingsFromProfile } from '../session/helpers';
import { LOCALE_LABELS, SUPPORTED_LOCALES, getLocalePreference, isLocale, setLocalePreference, useT, type LocalePreference } from '../i18n';

type SettingsSection = 'general' | 'features' | 'appearance' | 'connection' | 'security' | 'notifications' | 'agent';

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
  const { settings, setSettings, backendConnections, activeBackendConnectionId, setActiveBackendConnectionId, updateBackendConnection, addBackendConnection, removeBackendConnection, connectionState, connectionHealth, serverVersion, versionMismatch, connect, closeSocket } = session;
  const [pairingAutoStart, setPairingAutoStart] = useState(0);
  // A tool's own settings page shown in place of everything else.
  const [agentPage, setAgentPage] = useState<AgentDesktopPage | null>(null);
  const [section, setSection] = useState<SettingsSection>('general');
  const agentPanel = useRef<HTMLDivElement>(null);
  const connected = connectionState === 'open' || connectionState === 'connecting';
  const activeProfile = backendConnections.find((item) => item.id === activeBackendConnectionId);
  useEffect(() => {
    if (repairPairing) setPairingAutoStart((value) => value + 1);
  }, [repairPairing]);
  // Re-pairing and recovery-key setup both live in the security section.
  useEffect(() => {
    if (repairPairing || historyRecoverySetup) setSection('security');
  }, [repairPairing, historyRecoverySetup]);
  // A tool page opens at its top, not at the overview's scroll offset.
  useEffect(() => {
    if (agentPage) agentPanel.current?.scrollTo({ top: 0 });
  }, [agentPage]);

  const sections: Array<{ id: SettingsSection; label: string; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> }> = [
    { id: 'general', label: t('settings.general'), icon: RiSettings3Line },
    { id: 'features', label: t('settings.features'), icon: RiApps2Line },
    { id: 'appearance', label: t('settings.appearance'), icon: RiPaletteLine },
    { id: 'connection', label: t('settings.connection'), icon: RiServerLine },
    { id: 'security', label: t('settings.security'), icon: RiShieldKeyholeLine },
    { id: 'notifications', label: t('settings.notifications'), icon: RiNotification3Line },
    { id: 'agent', label: t('agentDesktop.title'), icon: RiComputerLine },
  ];
  const titleOf = (id: SettingsSection) => sections.find((item) => item.id === id)?.label ?? '';

  // A different backend never keeps the old device key or transport pin.
  const updateServerUrl = (serverUrl: string) => {
    if (!activeProfile) return;
    const changed = normalizeServerUrl(activeProfile.serverUrl) !== normalizeServerUrl(serverUrl);
    updateBackendConnection(activeProfile.id, { serverUrl, ...(changed ? UNPAIRED_TRANSPORT : {}) });
    setSettings((current) => ({ ...current, serverUrl, ...(changed ? UNPAIRED_TRANSPORT : {}) }));
  };

  const selectBackend = (id: string) => {
    const profile = backendConnections.find((item) => item.id === id);
    if (!profile) return;
    setActiveBackendConnectionId(profile.id);
    setSettings((current) => settingsFromProfile(profile, current));
  };

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

        <SettingsPage id="connection" title={titleOf('connection')}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body-regular text-text-secondary">{healthLabelOf(connectionHealth)} · {connectionStateLabel(connectionState)}</p>
            {serverVersion ? (
              <Chip variant="caption" color={versionMismatch ? 'yellow' : 'neutral'}>{serverVersion.name} {serverVersion.version}{settings.tenantId ? ` · ${settings.tenantId}` : ''}{versionMismatch ? ` · ${t('conn.versionMismatchShort')}` : ''}</Chip>
            ) : null}
          </div>
          <SettingsGroup
            className="gap-3"
            label={t('settings.backendConnections')}
            action={<Button size="small" variant="secondary" onClick={() => addBackendConnection()}>{t('settings.addBackend')}</Button>}
          >
            <RadioGroup
              className={cx('grid gap-2', backendConnections.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}
              name="backend-connection"
              value={activeBackendConnectionId}
              onChange={selectBackend}
            >
              <Label className="col-span-full px-3 text-body-2-regular text-text-secondary">{t('settings.currentBackend')}</Label>
              {backendConnections.map((profile) => (
                <RadioCard
                  key={profile.id}
                  value={profile.id}
                  title={<span className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: backendLabelColor(profile) }} /><span className="truncate">{profile.name}</span></span>}
                  description={profile.tenantId ? `${profile.serverUrl} · ${profile.tenantId}` : profile.serverUrl}
                />
              ))}
            </RadioGroup>
            {activeProfile ? (
              <>
                <SettingsCard>
                  <SettingsRow label={t('settings.name')}>
                    <Input aria-label={t('settings.name')} name={t('settings.name')} size="small" className="w-64" value={activeProfile.name} onChange={(name) => updateBackendConnection(activeProfile.id, { name })} />
                  </SettingsRow>
                  <SettingsRow label={t('settings.labelColor')} description={t('settings.labelColorHint')}>
                    <RadioGroup
                      aria-label={t('settings.labelColorAria')}
                      orientation="horizontal"
                      className="flex flex-wrap items-center gap-2"
                      value={backendLabelColor(activeProfile)}
                      onChange={(color) => updateBackendConnection(activeProfile.id, { labelColor: color })}
                    >
                      {BACKEND_LABEL_COLORS.map(({ value, label }) => (
                        <Radio
                          key={value}
                          value={value}
                          aria-label={label}
                          className={({ isSelected, isFocusVisible }) => cx(
                            'size-6 cursor-pointer rounded-full outline-none transition-shadow duration-150 ease',
                            (isSelected || isFocusVisible) && 'ring-2 ring-border-focus-ring ring-offset-2 ring-offset-background-secondary-default',
                          )}
                          style={{ backgroundColor: value }}
                        />
                      ))}
                    </RadioGroup>
                  </SettingsRow>
                  <SettingsRow label={t('settings.serverUrl')} description={<span className="text-status-yellow-text">{t('settings.credentialWarning')}</span>}>
                    <Input aria-label={t('settings.serverUrl')} name={t('settings.serverUrl')} size="small" className="w-64" value={activeProfile.serverUrl} onChange={updateServerUrl} />
                  </SettingsRow>
                  <SettingsRow label="Tenant">
                    <Input aria-label="Tenant" name="Tenant" size="small" className="w-64" value={activeProfile.tenantId} onChange={(tenantId) => { updateBackendConnection(activeProfile.id, { tenantId }); setSettings((current) => ({ ...current, tenantId })); }} />
                  </SettingsRow>
                </SettingsCard>
                <div className="flex gap-2">
                  <Button size="small" onClick={() => (connected ? closeSocket(true) : connect())}>{connected ? t('settings.disconnect') : connectionState === 'error' ? t('settings.retry') : t('settings.connect')}</Button>
                  {backendConnections.length > 1 ? <Button size="small" variant="danger" onClick={() => removeBackendConnection(activeProfile.id)}>{t('settings.removeBackend')}</Button> : null}
                </div>
              </>
            ) : null}
          </SettingsGroup>
        </SettingsPage>

        <SettingsPage id="security" title={titleOf('security')}>
          {activeProfile ? (
            <>
              <DevicePairingPanel session={session} deviceName="TodeX Desktop" autoStartNonce={pairingAutoStart} />
              <HistoryEncryptionPanel history={session.historyEncryption} autoStartRecovery={historyRecoverySetup} />
            </>
          ) : null}
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

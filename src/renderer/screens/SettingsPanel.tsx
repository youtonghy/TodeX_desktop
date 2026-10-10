import { useEffect, useRef, useState } from 'react';
import { Button, Chip, ColorSwatchPicker, Description, Label, ListBox, Select, Surface, Switch, Tabs, toast } from '@heroui/react';
import { RadioButtonGroup } from '@heroui-pro/react';
import { normalizeServerUrl } from '@todex/protocol/todex';
import { BACKEND_LABEL_COLORS, backendLabelColor } from '../session/backendColors';
import { Field } from '../components/Field';
import { DevicePairingPanel } from '../components/DevicePairingPanel';
import { HistoryEncryptionPanel } from '../components/HistoryEncryptionPanel';
import { AgentDesktopSettings, type AgentDesktopPage } from '../components/AgentDesktopSettings';
import type { TodeXSession } from '../session/useTodeXSession';
import { UNPAIRED_TRANSPORT, connectionStateLabel, healthLabelOf, settingsFromProfile } from '../session/helpers';
import { LOCALE_LABELS, SUPPORTED_LOCALES, getLocalePreference, isLocale, setLocalePreference, useT, type LocalePreference } from '../i18n';

type SettingsSection = 'connection' | 'general' | 'agent';

type Props = {
  session: TodeXSession;
  /** Start setting up a history recovery key (from the global notice). */
  historyRecoverySetup?: boolean;
  /** Start device pairing again (from a refused connection's re-pair action). */
  repairPairing?: boolean;
};

export function SettingsPanel({ session, historyRecoverySetup = false, repairPairing = false }: Props) {
  const t = useT();
  const [languagePreference, setLanguagePreference] = useState<LocalePreference>(() => getLocalePreference());
  const { settings, setSettings, backendConnections, activeBackendConnectionId, setActiveBackendConnectionId, updateBackendConnection, addBackendConnection, removeBackendConnection, connectionState, connectionHealth, serverVersion, versionMismatch, connect, closeSocket } = session;
  const [pairingAutoStart, setPairingAutoStart] = useState(0);
  // A tool's own settings page shown in place of everything else.
  const [agentPage, setAgentPage] = useState<AgentDesktopPage | null>(null);
  const [section, setSection] = useState<SettingsSection>('connection');
  const root = useRef<HTMLDivElement>(null);
  const connected = connectionState === 'open' || connectionState === 'connecting';
  const activeProfile = backendConnections.find((item) => item.id === activeBackendConnectionId);
  useEffect(() => {
    if (repairPairing) setPairingAutoStart((value) => value + 1);
  }, [repairPairing]);
  // Re-pairing and recovery-key setup both live in the connection section.
  useEffect(() => {
    if (repairPairing || historyRecoverySetup) setSection('connection');
  }, [repairPairing, historyRecoverySetup]);
  // The settings body keeps its scroll offset across pages; a page starts at its top.
  useEffect(() => {
    if (agentPage) root.current?.scrollIntoView({ block: 'start' });
  }, [agentPage]);

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

  // Inactive sections stay mounted (hidden), so an in-progress pairing or
  // recovery-key setup survives a visit to another section.
  const panelClassName = 'flex flex-col gap-6 data-[inert=true]:hidden';
  return (
    <Tabs ref={root} className="gap-5 py-1" selectedKey={section} onSelectionChange={(key) => setSection(key as SettingsSection)}>
      <Tabs.ListContainer className="bg-overlay sticky top-0 z-10">
        <Tabs.List aria-label={t('app.settings')}>
          <Tabs.Tab id="connection">{t('settings.connection')}<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="general">{t('settings.general')}<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="agent">{t('agentDesktop.title')}<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="connection" shouldForceMount className={panelClassName}>
        <div>
          <p className="text-muted text-sm">{healthLabelOf(connectionHealth)} · {connectionStateLabel(connectionState)}</p>
          {serverVersion ? (
            <Chip className="mt-2" variant="soft" color={versionMismatch ? 'warning' : 'default'}>{serverVersion.name} {serverVersion.version}{settings.tenantId ? ` · ${settings.tenantId}` : ''}{versionMismatch ? ` · ${t('conn.versionMismatchShort')}` : ''}</Chip>
          ) : null}
        </div>
        <Surface className="flex flex-col gap-4 rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t('settings.backendConnections')}</h3>
            <Button size="sm" variant="secondary" onPress={() => addBackendConnection()}>{t('settings.addBackend')}</Button>
          </div>
          <RadioButtonGroup
            className={backendConnections.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}
            layout="grid"
            name="backend-connection"
            value={activeBackendConnectionId}
            variant="secondary"
            onChange={selectBackend}
          >
            <Label className="col-span-full">{t('settings.currentBackend')}</Label>
            {backendConnections.map((profile) => (
              <RadioButtonGroup.Item key={profile.id} value={profile.id}>
                <RadioButtonGroup.Indicator />
                <RadioButtonGroup.ItemContent>
                  <Label className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: backendLabelColor(profile) }} />{profile.name}</Label>
                  <Description className="truncate">{profile.tenantId ? `${profile.serverUrl} · ${profile.tenantId}` : profile.serverUrl}</Description>
                </RadioButtonGroup.ItemContent>
              </RadioButtonGroup.Item>
            ))}
          </RadioButtonGroup>
          {activeProfile ? (
            <>
              <Field label={t('settings.name')} value={activeProfile.name} onChange={(name) => updateBackendConnection(activeProfile.id, { name })} />
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('settings.labelColor')}</span>
                <ColorSwatchPicker
                  aria-label={t('settings.labelColorAria')}
                  value={backendLabelColor(activeProfile)}
                  onChange={(color) => updateBackendConnection(activeProfile.id, { labelColor: color.toString('hex') })}
                >
                  {BACKEND_LABEL_COLORS.map(({ value, label }) => (
                    <ColorSwatchPicker.Item key={value} color={value} aria-label={label}>
                      <ColorSwatchPicker.Swatch />
                      <ColorSwatchPicker.Indicator />
                    </ColorSwatchPicker.Item>
                  ))}
                </ColorSwatchPicker>
                <p className="text-muted text-xs">{t('settings.labelColorHint')}</p>
              </div>
              <Field label={t('settings.serverUrl')} value={activeProfile.serverUrl} onChange={updateServerUrl} />
              <p className="text-warning-soft-foreground text-xs">{t('settings.credentialWarning')}</p>
              <Field label="Tenant" value={activeProfile.tenantId} onChange={(tenantId) => { updateBackendConnection(activeProfile.id, { tenantId }); setSettings((current) => ({ ...current, tenantId })); }} />
              <DevicePairingPanel session={session} deviceName="TodeX Desktop" autoStartNonce={pairingAutoStart} />
              <HistoryEncryptionPanel history={session.historyEncryption} autoStartRecovery={historyRecoverySetup} />
              <div className="flex gap-2"><Button onPress={() => (connected ? closeSocket(true) : connect())}>{connected ? t('settings.disconnect') : connectionState === 'error' ? t('settings.retry') : t('settings.connect')}</Button>{backendConnections.length > 1 ? <Button variant="danger-soft" onPress={() => removeBackendConnection(activeProfile.id)}>{t('settings.removeBackend')}</Button> : null}</div>
            </>
          ) : null}
        </Surface>
      </Tabs.Panel>
      <Tabs.Panel id="general" shouldForceMount className={panelClassName}>
        <Surface className="flex flex-col gap-4 rounded-2xl p-5">
          <h3 className="font-semibold">{t('settings.language')}</h3>
          <Select
            value={languagePreference}
            onChange={(value) => {
              if (value === 'auto' || isLocale(value)) {
                const preference = value as LocalePreference;
                setLanguagePreference(preference);
                setLocalePreference(preference);
              }
            }}
          >
            <Label>{t('common.language')}</Label>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="auto" textValue={t('common.language.auto')}>
                  {t('common.language.auto')}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                {SUPPORTED_LOCALES.map((locale) => (
                  <ListBox.Item key={locale} id={locale} textValue={LOCALE_LABELS[locale]}>
                    {LOCALE_LABELS[locale]}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
            <Description>{t('settings.languageHint')}</Description>
          </Select>
        </Surface>
        <Surface className="flex flex-col gap-4 rounded-2xl p-5">
          <h3 className="font-semibold">{t('settings.aside')}</h3>
          <Select
            value={session.workbenchSharing}
            isDisabled={!session.workbenchSharingHydrated}
            onChange={(value) => {
              if (value === 'conversation' || value === 'workspace') session.setWorkbenchSharing(value);
            }}
          >
            <Label>{t('settings.asideSharing')}</Label>
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="conversation" textValue={t('settings.shareConversation')}>
                  {t('settings.shareConversation')}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="workspace" textValue={t('settings.shareWorkspace')}>
                  {t('settings.shareWorkspace')}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
            <Description>
              {session.workbenchSharing === 'workspace'
                ? t('settings.shareWorkspaceHint')
                : t('settings.shareConversationHint')}
            </Description>
          </Select>
        </Surface>
        <Surface className="flex flex-col gap-4 rounded-2xl p-5">
          <h3 className="font-semibold">{t('settings.notifications')}</h3>
          <Switch
            isSelected={session.completionNotifications}
            isDisabled={!session.completionNotificationsHydrated}
            onChange={(selected) => {
              void session.setCompletionNotifications(selected).then((result) => {
                if (result === 'denied') toast.danger(t('settings.notifyDenied'));
                if (result === 'unsupported') toast.danger(t('settings.notifyUnsupported'));
              });
            }}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <div>
                <p className="text-sm font-medium">{t('settings.notifyTaskDone')}</p>
                <p className="text-muted text-xs">
                  {session.completionNotificationsSupported
                    ? t('settings.notifyTaskDoneHint')
                    : t('settings.notifyUnsupported')}
                </p>
              </div>
            </Switch.Content>
          </Switch>
        </Surface>
      </Tabs.Panel>
      <Tabs.Panel id="agent" shouldForceMount className={panelClassName}>
        <AgentDesktopSettings session={session} page={agentPage} onPageChange={setAgentPage} />
      </Tabs.Panel>
    </Tabs>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Chip, Separator, Surface, Switch, toast } from '@heroui/react';
import { ItemCard, ItemCardGroup } from '@heroui-pro/react';
import { RiArrowLeftSLine, RiArrowRightSLine, RiComputerLine, RiGlobalLine } from '@remixicon/react';
import type { AgentDesktopSettings as Settings } from '@todex/protocol/agentDesktop';
import { ConnectionError } from '@todex/protocol/connectionError';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';
import { AgentBrowserSettings } from './AgentBrowserSettings';
import { ComputerUseSettings } from './ComputerUseSettings';

/** A tool with its own settings page; `null` is the settings overview. */
export type AgentDesktopPage = 'browser' | 'computer';

type ChipColor = 'success' | 'warning' | 'default' | 'danger';

/**
 * Agent desktop tools for the active backend. The agent browser and
 * Computer Use both run on the backend's computer; this app only watches
 * them, so everything here is backend state.
 *
 * The overview keeps only the master switch and one entry per tool; each
 * tool's details live on its own page, which replaces the whole settings
 * panel while `page` is set. This component stays mounted across pages so
 * the settings and their polling carry over.
 */
export function AgentDesktopSettings({ session, page = null, onPageChange = () => {} }: {
  session: TodeXSession;
  page?: AgentDesktopPage | null;
  onPageChange?: (page: AgentDesktopPage | null) => void;
}) {
  const t = useT();
  const api = useMemo(
    () => backendApi(session.settings),
    [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.transportVerified, session.settings.serverUrl],
  );
  // `null`: the backend predates desktop tools.
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [legacyData, setLegacyData] = useState(false);
  // The entry a page was opened from takes focus again on the way back.
  const lastPage = useRef<AgentDesktopPage | null>(null);
  const overview = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.getAgentDesktop());
    } catch (error) {
      // A transient failure keeps the last known settings (the switch and
      // sections stay put); only a backend without desktop tools clears them.
      setSettings(current => error instanceof ConnectionError && error.httpStatus === 404 ? null : current);
    }
  }, [api]);
  useEffect(() => {
    // Settings of another backend must not stand in while this one loads.
    setSettings(undefined);
    void refresh();
    void window.todexDesktop.legacyAgentBrowser.hasData().then(setLegacyData);
    // Chromium downloads and host permissions change outside this screen.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  // A page only exists while the tools are on; turning them off (here or
  // from another client) or losing the backend's support returns to the overview.
  const enabled = settings?.enabled === true;
  useEffect(() => {
    if (page && settings !== undefined && !enabled) onPageChange(null);
  }, [page, settings, enabled, onPageChange]);
  useEffect(() => {
    if (page) {
      lastPage.current = page;
    } else if (lastPage.current) {
      overview.current?.querySelector<HTMLButtonElement>(`[data-agent-desktop-page="${lastPage.current}"]`)?.focus();
      lastPage.current = null;
    }
  }, [page]);

  const save = async (work: () => Promise<Settings>) => {
    setSaving(true);
    try {
      setSettings(await work());
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('agentDesktop.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const clearLegacyData = async () => {
    if (!window.confirm(t('agentDesktop.legacyDataConfirm'))) return;
    try {
      await window.todexDesktop.legacyAgentBrowser.clear();
      setLegacyData(false);
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

  if (page && settings?.enabled) {
    const back = () => onPageChange(null);
    if (page === 'browser') {
      return (
        <SettingsSubpage
          title={t('agentBrowser.title')}
          description={settings.browser ? t('agentBrowser.settingsHint', { host: settings.browser.host }) : undefined}
          onBack={back}
        >
          <AgentBrowserSettings session={session} api={api} settings={settings} onSettings={setSettings} />
        </SettingsSubpage>
      );
    }
    return (
      <SettingsSubpage title={t('computerSettings.title')} onBack={back}>
        <ComputerUseSettings
          settings={settings}
          saving={saving}
          onEnable={selected => { void save(() => api.setAgentComputerEnabled(selected)); }}
          onRequestPermission={permission => { void save(() => api.requestComputerPermissions(permission)); }}
        />
      </SettingsSubpage>
    );
  }

  const browser = settings ? browserSummary(settings, t) : undefined;
  const computer = settings ? computerSummary(settings, t) : undefined;
  return (
    <Surface ref={overview} className="flex flex-col gap-4 rounded-2xl p-5">
      <h3 className="font-semibold">{t('agentDesktop.title')}</h3>
      <Switch isSelected={enabled} isDisabled={settings === undefined || saving} onChange={selected => { void save(() => api.setAgentDesktopEnabled(selected)); }}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <div>
            <p className="text-sm font-medium">{t('agentDesktop.enable')}</p>
            <p className="text-muted text-xs">{t('agentDesktop.enableHint')}</p>
          </div>
        </Switch.Content>
      </Switch>
      <ItemCardGroup className="overflow-hidden">
        <SettingsEntry
          page="browser"
          icon={<RiGlobalLine />}
          title={t('agentBrowser.title')}
          description={t('agentDesktop.browserEntry')}
          status={enabled ? browser : undefined}
          isDisabled={!enabled}
          onPress={() => onPageChange('browser')}
        />
        <Separator />
        <SettingsEntry
          page="computer"
          icon={<RiComputerLine />}
          title={t('computerSettings.title')}
          description={t('agentDesktop.computerEntry')}
          status={enabled ? computer : undefined}
          isDisabled={!enabled}
          onPress={() => onPageChange('computer')}
        />
      </ItemCardGroup>
      {legacyData ? (
        <div className="border-separator flex items-center gap-3 border-t pt-4">
          <p className="text-muted min-w-0 flex-1 text-xs">{t('agentDesktop.legacyData')}</p>
          <Button size="sm" variant="secondary" onPress={() => { void clearLegacyData(); }}>{t('agentDesktop.legacyDataClear')}</Button>
        </div>
      ) : null}
    </Surface>
  );
}

type Summary = { label: string; color: ChipColor };

function browserSummary(settings: Settings, t: ReturnType<typeof useT>): Summary {
  const chromium = settings.browser?.chromium;
  if (!chromium) return { label: t('agentDesktop.statusUpdateBackend'), color: 'warning' };
  if (chromium.installed) return settings.browser?.available === false
    ? { label: t('agentDesktop.statusUnavailable'), color: 'warning' }
    : { label: t('agentDesktop.statusReady'), color: 'success' };
  if (chromium.downloading) return { label: t('agentDesktop.statusDownloading', { progress: Math.round((chromium.progress ?? 0) * 100) }), color: 'default' };
  return { label: t('agentDesktop.statusNotInstalled'), color: chromium.error ? 'danger' : 'warning' };
}

function computerSummary(settings: Settings, t: ReturnType<typeof useT>): Summary {
  const computer = settings.computer;
  if (!computer) return { label: t('agentDesktop.statusUpdateBackend'), color: 'warning' };
  if (!computer.supported) return { label: t('agentDesktop.statusUnavailable'), color: 'default' };
  if (!settings.computerEnabled) return { label: t('agentDesktop.statusOff'), color: 'default' };
  return computer.permissions.screen && computer.permissions.accessibility
    ? { label: t('agentDesktop.statusOn'), color: 'success' }
    : { label: t('agentDesktop.statusNeedsPermission'), color: 'warning' };
}

/** A row in the overview that opens a tool's own settings page. */
function SettingsEntry({ page, icon, title, description, status, isDisabled, onPress }: {
  page: AgentDesktopPage;
  icon: ReactNode;
  title: string;
  description: string;
  status?: Summary;
  isDisabled: boolean;
  onPress: () => void;
}) {
  return (
    <ItemCard<'button'>
      variant="transparent"
      className="hover:bg-default/40 w-full cursor-pointer text-start transition-colors disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
      render={props => <button {...props} type="button" data-agent-desktop-page={page} disabled={isDisabled} onClick={onPress} />}
    >
      <ItemCard.Icon>{icon}</ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title>{title}</ItemCard.Title>
        <ItemCard.Description>{description}</ItemCard.Description>
      </ItemCard.Content>
      <ItemCard.Action className="flex items-center gap-2">
        {status ? <Chip size="sm" variant="soft" color={status.color}>{status.label}</Chip> : null}
        <RiArrowRightSLine className="text-muted size-4 rtl:-scale-x-100" aria-hidden />
      </ItemCard.Action>
    </ItemCard>
  );
}

/** A tool's own settings page, shown in place of the settings overview. */
function SettingsSubpage({ title, description, onBack, children }: {
  title: string;
  description?: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2">
        <Button isIconOnly size="sm" variant="ghost" className="-ms-2 shrink-0" aria-label={t('settings.back')} onPress={onBack}>
          <RiArrowLeftSLine className="size-5 rtl:-scale-x-100" />
        </Button>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-foreground text-xl font-semibold">{title}</h2>
          {description ? <p className="text-muted mt-1 text-sm">{description}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

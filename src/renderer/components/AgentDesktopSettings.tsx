import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { RiArrowLeftSLine, RiArrowRightSLine, RiComputerLine, RiGlobalLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Switch } from '@/components/base/switch/switch';
import { cx } from '@/utils/cx';
import type { AgentDesktopSettings as Settings } from '@todex/protocol/agentDesktop';
import { ConnectionError } from '@todex/protocol/connectionError';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';
import { AgentBrowserSettings } from './AgentBrowserSettings';
import { ComputerUseSettings } from './ComputerUseSettings';
import { SettingsCard, SettingsNote, SettingsRow } from './settings/SettingsRows';
import { IconAction } from './ui/icon-action';
import { toast } from './ui/toast';

/** A tool with its own settings page; `null` is the settings overview. */
export type AgentDesktopPage = 'browser' | 'computer';

type ChipColor = 'success' | 'warning' | 'default' | 'danger';
const CHIP_COLORS = { success: 'lime', warning: 'yellow', default: 'neutral', danger: 'rose' } as const;

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
      <SettingsCard>
        <SettingsNote className="py-3 text-body-regular">{t('agentDesktop.unsupported')}</SettingsNote>
      </SettingsCard>
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
  // The settings section tab already names this page, so it has no heading.
  return (
    <div ref={overview} className="flex flex-col gap-6">
      <SettingsCard>
        <SettingsRow label={t('agentDesktop.enable')} description={t('agentDesktop.enableHint')}>
          <Switch
            size="sm"
            aria-label={t('agentDesktop.enable')}
            isSelected={enabled}
            isDisabled={settings === undefined || saving}
            onChange={selected => { void save(() => api.setAgentDesktopEnabled(selected)); }}
          />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard className="overflow-hidden ps-0">
        <SettingsEntry
          page="browser"
          icon={RiGlobalLine}
          title={t('agentBrowser.title')}
          description={t('agentDesktop.browserEntry')}
          status={enabled ? browser : undefined}
          isDisabled={!enabled}
          onPress={() => onPageChange('browser')}
        />
        <SettingsEntry
          page="computer"
          icon={RiComputerLine}
          title={t('computerSettings.title')}
          description={t('agentDesktop.computerEntry')}
          status={enabled ? computer : undefined}
          isDisabled={!enabled}
          onPress={() => onPageChange('computer')}
        />
      </SettingsCard>
      {legacyData ? (
        <SettingsCard>
          <SettingsRow description={t('agentDesktop.legacyData')}>
            <Button size="small" variant="secondary" onClick={() => { void clearLegacyData(); }}>{t('agentDesktop.legacyDataClear')}</Button>
          </SettingsRow>
        </SettingsCard>
      ) : null}
    </div>
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
function SettingsEntry({ page, icon: Icon, title, description, status, isDisabled, onPress }: {
  page: AgentDesktopPage;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  title: string;
  description: string;
  status?: Summary;
  isDisabled: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      data-agent-desktop-page={page}
      disabled={isDisabled}
      onClick={onPress}
      className={cx(
        'group flex w-full cursor-pointer items-center gap-3 ps-3 text-start',
        'outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring',
        'disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0 text-foreground-icon-secondary" />
      <span className="flex min-h-[52px] min-w-0 flex-1 items-center gap-4 border-b border-separator-border py-2.5 pe-2.5 group-last:border-b-0">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body-regular text-text-primary">{title}</span>
          <span className="text-body-2-regular text-text-secondary">{description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {status ? <Chip variant="caption" color={CHIP_COLORS[status.color]}>{status.label}</Chip> : null}
          <RiArrowRightSLine className="size-4 text-foreground-icon-tertiary rtl:-scale-x-100" aria-hidden />
        </span>
      </span>
    </button>
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
        <IconAction icon={RiArrowLeftSLine} size="sm" className="-ms-1.5 shrink-0" iconClassName="size-5 rtl:-scale-x-100" aria-label={t('settings.back')} onClick={onBack} />
        <div className="min-w-0 pt-0.5">
          <h3 className="text-headline-medium text-text-primary">{title}</h3>
          {description ? <p className="mt-1 text-body-regular text-text-secondary">{description}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

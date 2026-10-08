import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Surface, Switch, toast } from '@heroui/react';
import type { AgentDesktopSettings as Settings } from '@todex/protocol/agentDesktop';
import { ConnectionError } from '@todex/protocol/connectionError';
import { AgentBrowserSettings } from './AgentBrowserSettings';
import { ComputerUseSettings } from './ComputerUseSettings';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';

/**
 * Agent desktop tools for the active backend. The agent browser and
 * Computer Use both run on the backend's computer; this app only watches
 * them, so everything here is backend state.
 */
export function AgentDesktopSettings({ session }: { session: TodeXSession }) {
  const t = useT();
  const api = useMemo(
    () => backendApi(session.settings),
    [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.transportVerified, session.settings.serverUrl],
  );
  // `null`: the backend predates desktop tools.
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [legacyData, setLegacyData] = useState(false);

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
  return (
    <Surface className="flex flex-col gap-4 rounded-2xl p-5">
      <h3 className="font-semibold">{t('agentDesktop.title')}</h3>
      <Switch isSelected={settings?.enabled ?? false} isDisabled={settings === undefined || saving} onChange={selected => { void save(() => api.setAgentDesktopEnabled(selected)); }}>
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
      {settings?.enabled ? (
        <>
          <AgentBrowserSettings session={session} api={api} settings={settings} onSettings={setSettings} />
          <ComputerUseSettings
            settings={settings}
            saving={saving}
            onEnable={selected => { void save(() => api.setAgentComputerEnabled(selected)); }}
            onRequestPermissions={() => { void save(() => api.requestComputerPermissions()); }}
          />
        </>
      ) : null}
      {legacyData ? (
        <div className="border-separator flex items-center gap-3 border-t pt-4">
          <p className="text-muted min-w-0 flex-1 text-xs">{t('agentDesktop.legacyData')}</p>
          <Button size="sm" variant="secondary" onPress={() => { void clearLegacyData(); }}>{t('agentDesktop.legacyDataClear')}</Button>
        </div>
      ) : null}
    </Surface>
  );
}

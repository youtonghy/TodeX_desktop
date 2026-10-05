import { Button, Chip, Switch } from '@heroui/react';
import type { AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import { useT } from '../i18n';

/**
 * Computer Use for the active backend: it controls the computer the backend
 * runs on, so the switch, the host's OS permissions and why it may be
 * unavailable all come from the backend.
 */
export function ComputerUseSettings({ settings, saving, onEnable, onRequestPermissions }: {
  settings: AgentDesktopSettings;
  saving: boolean;
  onEnable: (enabled: boolean) => void;
  onRequestPermissions: () => void;
}) {
  const t = useT();
  const status = settings.computer;
  const missing = status ? !status.permissions.screen || !status.permissions.accessibility : false;
  return (
    <div className="border-separator flex flex-col gap-3 border-t pt-4">
      <p className="text-sm font-medium">{t('computerSettings.title')}</p>
      {status ? (
        <>
          <Switch isSelected={settings.computerEnabled} isDisabled={saving || !status.supported} onChange={onEnable}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <div>
                <p className="text-sm font-medium">{t('computerSettings.enable', { host: status.host })}</p>
                <p className="text-muted text-xs">{t('computerSettings.enableHint')}</p>
              </div>
            </Switch.Content>
          </Switch>
          {status.supported ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Chip size="sm" variant="soft" color={status.permissions.screen ? 'success' : 'warning'}>
                {t(status.permissions.screen ? 'computerSettings.screenOk' : 'computerSettings.screenMissing')}
              </Chip>
              <Chip size="sm" variant="soft" color={status.permissions.accessibility ? 'success' : 'warning'}>
                {t(status.permissions.accessibility ? 'computerSettings.axOk' : 'computerSettings.axMissing')}
              </Chip>
              {missing ? (
                <Button size="sm" variant="secondary" isDisabled={saving} onPress={onRequestPermissions}>
                  {t('computerSettings.grant')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {missing && status.supported ? (
            <p className="text-muted text-xs">{t('computerSettings.grantHint', { host: status.host })}</p>
          ) : status.reason ? (
            <p className="text-muted text-xs">{status.reason}</p>
          ) : null}
        </>
      ) : (
        <p className="text-muted text-xs">{t('computerSettings.legacyBackend')}</p>
      )}
    </div>
  );
}

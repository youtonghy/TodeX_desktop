import type { ComponentType } from 'react';
import { RiComputerLine, RiCursorLine, RiScreenshot2Line } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Switch } from '@/components/base/switch/switch';
import type { AgentComputerPermission, AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import { useT } from '../i18n';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from './settings/SettingsRows';

/**
 * Computer Use's settings page for the active backend: it controls the
 * computer the backend runs on, so the switch, the host's OS permissions and
 * why it may be unavailable all come from the backend.
 */
export function ComputerUseSettings({ settings, saving, onEnable, onRequestPermission }: {
  settings: AgentDesktopSettings;
  saving: boolean;
  onEnable: (enabled: boolean) => void;
  /** Asks the person at the backend's computer for one permission. */
  onRequestPermission: (permission: AgentComputerPermission) => void;
}) {
  const t = useT();
  const status = settings.computer;
  if (!status) return <p className="text-body-regular text-text-secondary">{t('computerSettings.legacyBackend')}</p>;
  const missing = !status.permissions.screen || !status.permissions.accessibility;
  const permissions: Array<{ key: AgentComputerPermission; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>; title: string; description: string; granted: boolean }> = [
    { key: 'screen', icon: RiScreenshot2Line, title: t('computerSettings.screen'), description: t('computerSettings.screenWhy'), granted: status.permissions.screen },
    { key: 'accessibility', icon: RiCursorLine, title: t('computerSettings.accessibility'), description: t('computerSettings.axWhy'), granted: status.permissions.accessibility },
  ];
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard>
        <SettingsRow icon={RiComputerLine} label={t('computerSettings.enable', { host: status.host })} description={t('computerSettings.enableHint')}>
          <Switch
            size="sm"
            aria-label={t('computerSettings.enable', { host: status.host })}
            isSelected={settings.computerEnabled}
            isDisabled={saving || !status.supported}
            onChange={onEnable}
          />
        </SettingsRow>
        {status.reason && !(missing && status.supported) ? <SettingsNote>{status.reason}</SettingsNote> : null}
      </SettingsCard>

      {status.supported ? (
        <SettingsGroup
          label={t('computerSettings.permissions')}
          description={missing ? t('computerSettings.grantHint', { host: status.host }) : t('computerSettings.permissionsHint', { host: status.host })}
        >
          <SettingsCard>
            {permissions.map((permission) => (
              <SettingsRow key={permission.key} icon={permission.icon} label={permission.title} description={permission.description}>
                {permission.granted ? (
                  <Chip variant="caption" color="lime">{t('computerSettings.granted')}</Chip>
                ) : (
                  <>
                    <Chip variant="caption" color="yellow">{t('computerSettings.notGranted')}</Chip>
                    <Button size="small" variant="secondary" disabled={saving} onClick={() => onRequestPermission(permission.key)}>
                      {t('computerSettings.grant')}
                    </Button>
                  </>
                )}
              </SettingsRow>
            ))}
          </SettingsCard>
        </SettingsGroup>
      ) : null}
    </div>
  );
}

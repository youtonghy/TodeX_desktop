import type { ComponentType } from 'react';
import { RiComputerLine, RiCursorLine, RiScreenshot2Line } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import type { AgentComputerEngine, AgentComputerPermission, AgentDesktopEngineStatus, AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import { useT } from '../i18n';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from './settings/SettingsRows';

const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';
const ENGINES: AgentComputerEngine[] = ['native', 'agentDesktop'];
const ENGINE_LABELS = { native: 'computerSettings.engineNative', agentDesktop: 'computerSettings.engineAgentDesktop' } as const;

/**
 * Computer Use's settings page for the active backend: it controls the
 * computer the backend runs on, so the switch, the host's OS permissions and
 * why it may be unavailable all come from the backend.
 */
export function ComputerUseSettings({ settings, saving, onEnable, onRequestPermission, onEngineChange }: {
  settings: AgentDesktopSettings;
  saving: boolean;
  onEnable: (enabled: boolean) => void;
  /** Asks the person at the backend's computer for one permission. */
  onRequestPermission: (permission: AgentComputerPermission) => void;
  /** Picks the engine; picking agent-desktop again retries its install. */
  onEngineChange: (engine: AgentComputerEngine) => void;
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

      {/* Absent from backends with only the built-in engine. */}
      {settings.computerEngine && settings.computerEngines && status.supported ? (
        <SettingsCard>
          <SettingsRow label={t('computerSettings.engine')} description={t('computerSettings.engineHint', { host: status.host })}>
              <Select
                aria-label={t('computerSettings.engine')}
                selectedKey={settings.computerEngine}
                isDisabled={saving || !settings.computerEnabled}
                triggerClassName={ROW_SELECT_TRIGGER}
                onSelectionChange={(value) => {
                  if (ENGINES.includes(value as AgentComputerEngine) && value !== settings.computerEngine) onEngineChange(value as AgentComputerEngine);
                }}
              >
                {ENGINES.map(id => <SelectItem key={id} id={id} textValue={t(ENGINE_LABELS[id])}>{t(ENGINE_LABELS[id])}</SelectItem>)}
              </Select>
            </SettingsRow>
            {settings.computerEngine === 'agentDesktop' ? (
              <AgentDesktopEngineRow
                engine={settings.computerEngines.agentDesktop}
                saving={saving}
                onRetry={() => onEngineChange('agentDesktop')}
              />
            ) : null}
        </SettingsCard>
      ) : null}

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

/** The agent-desktop install on the backend's computer. */
function AgentDesktopEngineRow({ engine, saving, onRetry }: {
  engine: AgentDesktopEngineStatus;
  saving: boolean;
  onRetry: () => void;
}) {
  const t = useT();
  const failed = !engine.installed && !engine.downloading && Boolean(engine.error);
  return (
    <>
      <SettingsRow
        label={t('computerSettings.engineAgentDesktop')}
        description={t('computerSettings.engineAgentDesktopHint', { version: engine.version })}
        align="start"
      >
        {engine.installed ? (
          <Chip variant="caption" color="lime">{t('computerSettings.engineReady')}</Chip>
        ) : engine.downloading ? (
          <Chip variant="caption" color="neutral">{t('computerSettings.engineDownloading', { percent: Math.round((engine.progress ?? 0) * 100) })}</Chip>
        ) : (
          <>
            <Chip variant="caption" color={failed ? 'rose' : 'yellow'}>{t(failed ? 'computerSettings.engineFailed' : 'computerSettings.engineMissing')}</Chip>
            <Button size="small" variant="secondary" disabled={saving} onClick={onRetry}>{t('computerSettings.engineRetry')}</Button>
          </>
        )}
      </SettingsRow>
      {failed ? <SettingsNote tone="danger">{engine.error}</SettingsNote> : null}
    </>
  );
}

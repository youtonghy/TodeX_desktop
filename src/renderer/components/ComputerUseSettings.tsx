import { Button, Chip, Separator, Switch } from '@heroui/react';
import { ItemCard, ItemCardGroup } from '@heroui-pro/react';
import { RiComputerLine, RiCursorLine, RiScreenshot2Line } from '@remixicon/react';
import type { AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import { useT } from '../i18n';

/**
 * Computer Use's settings page for the active backend: it controls the
 * computer the backend runs on, so the switch, the host's OS permissions and
 * why it may be unavailable all come from the backend.
 */
export function ComputerUseSettings({ settings, saving, onEnable, onRequestPermissions }: {
  settings: AgentDesktopSettings;
  saving: boolean;
  onEnable: (enabled: boolean) => void;
  onRequestPermissions: () => void;
}) {
  const t = useT();
  const status = settings.computer;
  if (!status) return <p className="text-muted text-sm">{t('computerSettings.legacyBackend')}</p>;
  const missing = !status.permissions.screen || !status.permissions.accessibility;
  const permissions = [
    { key: 'screen', icon: <RiScreenshot2Line />, title: t('computerSettings.screen'), description: t('computerSettings.screenWhy'), granted: status.permissions.screen },
    { key: 'accessibility', icon: <RiCursorLine />, title: t('computerSettings.accessibility'), description: t('computerSettings.axWhy'), granted: status.permissions.accessibility },
  ];
  return (
    <div className="flex flex-col gap-6">
      <ItemCardGroup variant="secondary">
        <ItemCard variant="transparent" className="items-start">
          <ItemCard.Icon><RiComputerLine /></ItemCard.Icon>
          <ItemCard.Content>
            <ItemCard.Title className="whitespace-normal">{t('computerSettings.enable', { host: status.host })}</ItemCard.Title>
            <ItemCard.Description className="whitespace-normal">{t('computerSettings.enableHint')}</ItemCard.Description>
          </ItemCard.Content>
          <ItemCard.Action>
            <Switch
              aria-label={t('computerSettings.enable', { host: status.host })}
              isSelected={settings.computerEnabled}
              isDisabled={saving || !status.supported}
              onChange={onEnable}
            >
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
          </ItemCard.Action>
        </ItemCard>
        {status.reason && !(missing && status.supported) ? <p className="text-muted px-4 pb-4 text-xs">{status.reason}</p> : null}
      </ItemCardGroup>

      {status.supported ? (
        <ItemCardGroup variant="secondary">
          <ItemCardGroup.Header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <ItemCardGroup.Title>{t('computerSettings.permissions')}</ItemCardGroup.Title>
              <ItemCardGroup.Description>
                {missing ? t('computerSettings.grantHint', { host: status.host }) : t('computerSettings.permissionsHint', { host: status.host })}
              </ItemCardGroup.Description>
            </div>
            {missing ? (
              <Button size="sm" variant="secondary" className="shrink-0" isDisabled={saving} onPress={onRequestPermissions}>
                {t('computerSettings.grant')}
              </Button>
            ) : null}
          </ItemCardGroup.Header>
          {permissions.map((permission, index) => (
            <div key={permission.key}>
              {index ? <Separator /> : null}
              <ItemCard variant="transparent">
                <ItemCard.Icon>{permission.icon}</ItemCard.Icon>
                <ItemCard.Content>
                  <ItemCard.Title>{permission.title}</ItemCard.Title>
                  <ItemCard.Description>{permission.description}</ItemCard.Description>
                </ItemCard.Content>
                <ItemCard.Action>
                  <Chip size="sm" variant="soft" color={permission.granted ? 'success' : 'warning'}>
                    {t(permission.granted ? 'computerSettings.granted' : 'computerSettings.notGranted')}
                  </Chip>
                </ItemCard.Action>
              </ItemCard>
            </div>
          ))}
        </ItemCardGroup>
      ) : null}
    </div>
  );
}

import { RiLayoutRightLine } from '@remixicon/react';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { setAgentDesktopPreferences, useAgentDesktopPreferences, type LiveViewPlacement } from '../session/agentDesktopPreferences';
import { useT } from '../i18n';
import { SettingsCard, SettingsRow } from './settings/SettingsRows';

/** Where one tool's live view shows on this device: the side panel or above the composer. */
export function LiveViewPlacementSetting({ tool }: { tool: 'browser' | 'computer' }) {
  const t = useT();
  const preferences = useAgentDesktopPreferences();
  const key = tool === 'browser' ? 'browserPlacement' : 'computerPlacement';
  return (
    <SettingsCard>
      <SettingsRow icon={RiLayoutRightLine} label={t('agentDesktop.placement')} description={t('agentDesktop.placementHint')}>
        <SegmentedControl
          aria-label={t('agentDesktop.placement')}
          selectedKeys={[preferences[key]]}
          onSelectionChange={(keys) => {
            const [placement] = [...keys] as LiveViewPlacement[];
            if (placement) setAgentDesktopPreferences({ [key]: placement });
          }}
        >
          <SegmentedControlItem id="sidebar">{t('agentDesktop.placementSidebar')}</SegmentedControlItem>
          <SegmentedControlItem id="composer">{t('agentDesktop.placementComposer')}</SegmentedControlItem>
        </SegmentedControl>
      </SettingsRow>
    </SettingsCard>
  );
}

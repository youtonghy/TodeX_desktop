import { RiKanbanView2, RiTerminalLine, RiTimerLine } from '@remixicon/react';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { SettingsCard, SettingsGroup, SettingsRow } from './settings/SettingsRows';
import { setFeatureMode, useFeatureModes, type FeatureId, type FeatureMode } from '../session/featureToggles';
import { useT, type MessageKey } from '../i18n';

const FEATURES: Array<{ id: FeatureId; label: MessageKey; hint: MessageKey; icon: typeof RiTimerLine }> = [
  { id: 'scheduledConversations', label: 'schedule.create', hint: 'settings.featureScheduleHint', icon: RiTimerLine },
  { id: 'terminal', label: 'sidebar.terminal', hint: 'settings.featureTerminalHint', icon: RiTerminalLine },
  { id: 'kanban', label: 'sidebar.kanban', hint: 'settings.featureKanbanHint', icon: RiKanbanView2 },
];

/** Shows each optional sidebar feature, folds it under "More", or turns it off. */
export function FeatureSettings() {
  const t = useT();
  const modes = useFeatureModes();
  return (
    <SettingsGroup description={t('settings.featuresNote')}>
      <SettingsCard>
        {FEATURES.map(({ id, label, hint, icon }) => (
          <SettingsRow key={id} icon={icon} label={t(label)} description={t(hint)}>
            <SegmentedControl
              aria-label={t(label)}
              selectedKeys={[modes[id]]}
              onSelectionChange={(keys) => {
                const [mode] = [...keys] as FeatureMode[];
                if (mode) setFeatureMode(id, mode);
              }}
            >
              <SegmentedControlItem id="shown">{t('settings.featureShown')}</SegmentedControlItem>
              <SegmentedControlItem id="folded">{t('settings.featureFolded')}</SegmentedControlItem>
              <SegmentedControlItem id="off">{t('settings.featureOff')}</SegmentedControlItem>
            </SegmentedControl>
          </SettingsRow>
        ))}
      </SettingsCard>
    </SettingsGroup>
  );
}

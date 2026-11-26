import { RiCalendarTodoLine, RiTerminalLine, RiTimerLine } from '@remixicon/react';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Switch } from '@/components/base/switch/switch';
import { SettingsCard, SettingsGroup, SettingsRow } from './settings/SettingsRows';
import { setFeatureMode, useFeatureModes, type FeatureId, type FeatureMode } from '../session/featureToggles';
import { useT, type MessageKey } from '../i18n';

/** `toggle` features live in the composer, not the sidebar: they are only on or off. */
const FEATURES: Array<{ id: FeatureId; label: MessageKey; hint: MessageKey; icon: typeof RiTimerLine; toggle?: boolean }> = [
  { id: 'scheduledConversations', label: 'schedule.feature', hint: 'settings.featureScheduleHint', icon: RiTimerLine, toggle: true },
  { id: 'terminal', label: 'sidebar.terminal', hint: 'settings.featureTerminalHint', icon: RiTerminalLine },
  { id: 'kanban', label: 'sidebar.kanban', hint: 'settings.featureKanbanHint', icon: RiCalendarTodoLine },
];

/** Shows each optional sidebar feature, folds it under "More", or turns it off. */
export function FeatureSettings() {
  const t = useT();
  const modes = useFeatureModes();
  return (
    <SettingsGroup description={t('settings.featuresNote')}>
      <SettingsCard>
        {FEATURES.map(({ id, label, hint, icon, toggle }) => (
          <SettingsRow key={id} icon={icon} label={t(label)} description={t(hint)}>
            {toggle ? (
              <Switch
                size="sm"
                aria-label={t(label)}
                isSelected={modes[id] !== 'off'}
                onChange={(on) => setFeatureMode(id, on ? 'shown' : 'off')}
              />
            ) : (
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
            )}
          </SettingsRow>
        ))}
      </SettingsCard>
    </SettingsGroup>
  );
}

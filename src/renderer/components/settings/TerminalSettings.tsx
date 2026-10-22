import { useState } from 'react';
import { Input } from '@/components/base/input/input';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { SettingsCard, SettingsGroup, SettingsRow } from './SettingsRows';
import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  setTerminalPreferences,
  useTerminalPreferences,
  type TerminalCursorStyle,
} from '../../session/terminalPreferences';
import { useT } from '../../i18n';

const FONT_SIZES = Array.from({ length: TERMINAL_FONT_SIZE_MAX - TERMINAL_FONT_SIZE_MIN + 1 }, (_, index) => TERMINAL_FONT_SIZE_MIN + index);

/** Terminal look and the shell integration switch; saved per device. */
export function TerminalSettings() {
  const t = useT();
  const preferences = useTerminalPreferences();
  const [typedFont, setTypedFont] = useState(preferences.fontFamily);

  return (
    <SettingsGroup label={t('settings.terminal')}>
      <SettingsCard>
        <SettingsRow label={t('settings.terminalFontSize')}>
          <Select
            aria-label={t('settings.terminalFontSize')}
            selectedKey={String(preferences.fontSize)}
            triggerClassName="h-8 w-auto gap-1 rounded-lg px-2 py-1.5"
            onSelectionChange={(value) => setTerminalPreferences({ fontSize: Number(value) })}
          >
            {FONT_SIZES.map((size) => (
              <SelectItem key={size} id={String(size)} textValue={String(size)}>{size}</SelectItem>
            ))}
          </Select>
        </SettingsRow>
        <SettingsRow label={t('settings.terminalFont')} description={t('settings.terminalFontHint')}>
          <Input
            aria-label={t('settings.terminalFont')}
            size="small"
            className="w-56"
            placeholder={t('settings.terminalFontDefault')}
            value={typedFont}
            onChange={setTypedFont}
            onBlur={() => setTerminalPreferences({ fontFamily: typedFont.trim() })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setTerminalPreferences({ fontFamily: typedFont.trim() });
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.terminalCursor')}>
          <SegmentedControl
            aria-label={t('settings.terminalCursor')}
            selectedKeys={[preferences.cursorStyle]}
            onSelectionChange={(keys) => {
              const [cursorStyle] = [...keys] as TerminalCursorStyle[];
              if (cursorStyle) setTerminalPreferences({ cursorStyle });
            }}
          >
            <SegmentedControlItem id="block">{t('settings.terminalCursorBlock')}</SegmentedControlItem>
            <SegmentedControlItem id="bar">{t('settings.terminalCursorBar')}</SegmentedControlItem>
            <SegmentedControlItem id="underline">{t('settings.terminalCursorUnderline')}</SegmentedControlItem>
          </SegmentedControl>
        </SettingsRow>
        <SettingsRow label={t('settings.terminalShellIntegration')} description={t('settings.terminalShellIntegrationHint')}>
          <Switch
            size="sm"
            aria-label={t('settings.terminalShellIntegration')}
            isSelected={preferences.shellIntegration}
            onChange={(shellIntegration) => setTerminalPreferences({ shellIntegration })}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsGroup>
  );
}

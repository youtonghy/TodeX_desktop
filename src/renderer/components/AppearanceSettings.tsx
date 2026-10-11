import { useState } from 'react';
import type { Key } from 'react-aria-components';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Slider } from '@/components/base/slider/slider';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Switch } from '@/components/base/switch/switch';
import { ComboBox, ComboBoxItem } from './ui/combo-box';
import { SettingsCard, SettingsNote, SettingsRow } from './settings/SettingsRows';
import {
  APPEARANCE_SCALE_MAX,
  APPEARANCE_SCALE_MIN,
  DEFAULT_APPEARANCE,
  listSystemFonts,
  updateAppearance,
  useAppearance,
  type ThemeSource,
} from '../lib/appearance';
import { useT } from '../i18n';

const DEFAULT_FONT_KEY = '__default__';

export function AppearanceSettings() {
  const t = useT();
  const appearance = useAppearance();
  // undefined: not requested yet; null: the platform cannot list fonts.
  const [fonts, setFonts] = useState<string[] | null | undefined>(undefined);
  const defaultLabel = t('settings.fontDefault');
  const [typedFont, setTypedFont] = useState(appearance.fontFamily ?? '');
  const [scale, setScale] = useState(Math.round(appearance.scale * 100));

  const families = fonts ?? [];
  const items = [
    { id: DEFAULT_FONT_KEY, name: defaultLabel },
    ...(appearance.fontFamily && !families.includes(appearance.fontFamily) ? [{ id: appearance.fontFamily, name: appearance.fontFamily }] : []),
    ...families.map((family) => ({ id: family, name: family })),
  ];

  const selectFont = (key: Key | null) => {
    if (key === null) return;
    updateAppearance({ fontFamily: key === DEFAULT_FONT_KEY ? null : String(key) });
  };

  const reset = () => {
    updateAppearance(DEFAULT_APPEARANCE);
    setTypedFont('');
    setScale(100);
  };

  return (
    <>
      <SettingsCard>
        <SettingsRow label={t('settings.theme')} description={t('settings.themeHint')}>
          <SegmentedControl
            aria-label={t('settings.theme')}
            selectedKeys={[appearance.theme]}
            onSelectionChange={(keys) => {
              const [theme] = [...keys] as ThemeSource[];
              if (theme) updateAppearance({ theme });
            }}
          >
            <SegmentedControlItem id="system">{t('settings.themeSystem')}</SegmentedControlItem>
            <SegmentedControlItem id="light">{t('settings.themeLight')}</SegmentedControlItem>
            <SegmentedControlItem id="dark">{t('settings.themeDark')}</SegmentedControlItem>
          </SegmentedControl>
        </SettingsRow>
      </SettingsCard>
      <SettingsCard>
        <SettingsRow label={t('settings.font')} description={fonts === null ? t('settings.fontUnavailable') : t('settings.fontHint')}>
          {fonts === null ? (
            // Without the Local Font Access API, any installed family is typed.
            <Input
              aria-label={t('settings.font')}
              size="small"
              className="w-56"
              placeholder={defaultLabel}
              value={typedFont}
              onChange={setTypedFont}
              onBlur={() => updateAppearance({ fontFamily: typedFont.trim() || null })}
            />
          ) : (
            <ComboBox
              aria-label={t('settings.font')}
              className="w-56"
              // defaultItems lets the ComboBox filter by what is typed.
              defaultItems={items}
              selectedKey={appearance.fontFamily ?? DEFAULT_FONT_KEY}
              onSelectionChange={selectFont}
              // The first listing asks for permission, so it runs from the click.
              onOpenChange={(open) => { if (open && fonts === undefined) void listSystemFonts().then(setFonts); }}
            >
              {(item: { id: string; name: string }) => (
                <ComboBoxItem id={item.id} textValue={item.name}>
                  <span className="truncate" style={item.id === DEFAULT_FONT_KEY ? undefined : { fontFamily: `"${item.name}"` }}>{item.name}</span>
                </ComboBoxItem>
              )}
            </ComboBox>
          )}
        </SettingsRow>
        <SettingsRow label={t('settings.boldText')} description={t('settings.boldTextHint')}>
          <Switch size="sm" aria-label={t('settings.boldText')} isSelected={appearance.boldText} onChange={(boldText) => updateAppearance({ boldText })} />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard>
        <SettingsNote className="flex flex-col gap-1 py-3">
          <Slider
            label={t('settings.scale')}
            thumbLabel={t('settings.scale')}
            minValue={APPEARANCE_SCALE_MIN * 100}
            maxValue={APPEARANCE_SCALE_MAX * 100}
            step={5}
            value={scale}
            onChange={setScale}
            // Applied on release: resizing the page under the thumb mid-drag
            // would move the slider away from the pointer.
            onChangeEnd={(value) => updateAppearance({ scale: value / 100 })}
            formatOptions={{ style: 'unit', unit: 'percent', maximumFractionDigits: 0 }}
          />
          <p>{t('settings.scaleHint')}</p>
        </SettingsNote>
      </SettingsCard>
      <div>
        <Button size="small" variant="secondary" onClick={reset}>{t('settings.appearanceReset')}</Button>
      </div>
    </>
  );
}

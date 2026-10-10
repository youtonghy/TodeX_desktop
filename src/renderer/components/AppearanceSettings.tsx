import { useState } from 'react';
import type { Key } from 'react-aria-components';
import { Button, ComboBox, Description, Input, Label, ListBox, Slider, Surface, Switch, TextField } from '@heroui/react';
import {
  APPEARANCE_SCALE_MAX,
  APPEARANCE_SCALE_MIN,
  DEFAULT_APPEARANCE,
  listSystemFonts,
  updateAppearance,
  useAppearance,
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
      <Surface className="flex flex-col gap-4 rounded-2xl p-5">
        {fonts === null ? (
          // Without the Local Font Access API, any installed family is typed.
          <TextField
            className="w-full"
            value={typedFont}
            onChange={setTypedFont}
            onBlur={() => updateAppearance({ fontFamily: typedFont.trim() || null })}
          >
            <Label>{t('settings.font')}</Label>
            <Input placeholder={defaultLabel} />
            <Description>{t('settings.fontUnavailable')}</Description>
          </TextField>
        ) : (
          <ComboBox
            className="w-full"
            // defaultItems lets the ComboBox filter by what is typed.
            defaultItems={items}
            selectedKey={appearance.fontFamily ?? DEFAULT_FONT_KEY}
            onSelectionChange={selectFont}
            // The first listing asks for permission, so it runs from the click.
            onOpenChange={(open) => { if (open && fonts === undefined) void listSystemFonts().then(setFonts); }}
          >
            <Label>{t('settings.font')}</Label>
            <ComboBox.InputGroup>
              <Input />
              <ComboBox.Trigger />
            </ComboBox.InputGroup>
            <Description>{t('settings.fontHint')}</Description>
            <ComboBox.Popover>
              <ListBox>
                {(item: { id: string; name: string }) => (
                  <ListBox.Item id={item.id} textValue={item.name}>
                    <span style={item.id === DEFAULT_FONT_KEY ? undefined : { fontFamily: `"${item.name}"` }}>{item.name}</span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                )}
              </ListBox>
            </ComboBox.Popover>
          </ComboBox>
        )}
        <Switch isSelected={appearance.boldText} onChange={(boldText) => updateAppearance({ boldText })}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <div>
              <p className="text-sm font-medium">{t('settings.boldText')}</p>
              <p className="text-muted text-xs">{t('settings.boldTextHint')}</p>
            </div>
          </Switch.Content>
        </Switch>
      </Surface>
      <Surface className="flex flex-col gap-4 rounded-2xl p-5">
        <Slider
          minValue={APPEARANCE_SCALE_MIN * 100}
          maxValue={APPEARANCE_SCALE_MAX * 100}
          step={5}
          value={scale}
          onChange={(value) => setScale(Array.isArray(value) ? value[0] : value)}
          // Applied on release: resizing the page under the thumb mid-drag
          // would move the slider away from the pointer.
          onChangeEnd={(value) => updateAppearance({ scale: (Array.isArray(value) ? value[0] : value) / 100 })}
          formatOptions={{ style: 'unit', unit: 'percent', maximumFractionDigits: 0 }}
        >
          <Label>{t('settings.scale')}</Label>
          <Slider.Output />
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
        <p className="text-muted text-xs">{t('settings.scaleHint')}</p>
      </Surface>
      <div>
        <Button size="sm" variant="secondary" onPress={reset}>{t('settings.appearanceReset')}</Button>
      </div>
    </>
  );
}

import { useEffect } from 'react';
import { RiCpuLine } from '@remixicon/react';
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from 'react-aria-components';
import type { ProviderModelDescriptor } from '@todex/protocol/v2';
import { normalizeReasoningEffort } from '@todex/protocol/todex';
import { Select, SelectItem } from '@/components/base/select/select';
import { cx } from '@/utils/cx';
import { useT } from '../../i18n';
import { modelDisplayLabel, reasoningEffortLabel } from '../../session/helpers';
import { resolveSmartStage, SMART_WORK_MODE_PROVIDER, type SmartStage, type SmartWorkModeConfig } from '../../session/smartWorkMode';
import type { TodeXSession } from '../../session/useTodeXSession';
import { COMPOSER_POPOVER } from '../chat/ComposerControls';
import { ModelReasoningCard } from '../ModelReasoningCard';
import { EFFORT_TEXT } from '../modelReasoning';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow, SettingsValueField } from './SettingsRows';

/** Compact select trigger for the right side of a settings row (as in SettingsPanel). */
const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';
/** The model trigger matches the row select's trigger. */
const MODEL_TRIGGER = cx(
  'flex h-8 max-w-60 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5',
  'border border-border-button-default bg-background-primary-default text-body-medium text-text-primary shadow-xs',
  'transition-colors duration-150 ease hover:border-border-button-hover hover:bg-background-primary-hover',
  'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:bg-background-primary-disabled disabled:text-text-tertiary disabled:shadow-none',
);
const NO_SKILL = '__none__';

/**
 * Settings → Smart work mode: the plan and execute stages of Claude Code's
 * smart work mode (models, efforts and the plan skill), one configuration
 * for this device. Models and skills come from the focused backend's
 * Claude Code.
 */
export function SmartWorkModeSettings({ session }: { session: TodeXSession }) {
  const t = useT();
  const config = session.smartWorkMode;
  const provider = session.v2Providers.find((item) => item.id === SMART_WORK_MODE_PROVIDER && item.available);
  const liveModels = session.providerModels[SMART_WORK_MODE_PROVIDER];
  const models = liveModels?.length ? liveModels : provider?.models ?? [];
  const catalog = session.capabilityCatalogs[SMART_WORK_MODE_PROVIDER];
  const { refreshCapabilityCatalog } = session;
  useEffect(() => {
    if (provider && !catalog) void refreshCapabilityCatalog(SMART_WORK_MODE_PROVIDER);
  }, [catalog, provider, refreshCapabilityCatalog]);

  if (!provider) {
    return (
      <div className="flex flex-col gap-6">
        <p className="px-3 text-body-2-regular text-text-secondary">{t('smart.description')}</p>
        <SettingsCard>
          <SettingsNote role="status">{t('smart.unavailable')}</SettingsNote>
        </SettingsCard>
      </div>
    );
  }

  const skills = [...new Set((catalog?.skills?.skills ?? []).filter((item) => item.valid).map((item) => item.name))]
    .sort((a, b) => a.localeCompare(b));
  const configuredSkill = config.plan.skill;
  const skillListed = !configuredSkill || skills.includes(configuredSkill);
  const update = (next: SmartWorkModeConfig) => session.setSmartWorkMode(next);
  const disabled = !session.smartWorkModeHydrated;

  return (
    <div className="flex flex-col gap-6">
      <p className="px-3 text-body-2-regular text-text-secondary">{t('smart.description')}</p>
      <SettingsGroup label={t('smart.planStage')}>
        <SettingsCard>
          <SettingsRow label={t('smart.model')} description={t('smart.planModelHint')}>
            <StageModelPicker
              session={session}
              label={`${t('smart.planStage')} · ${t('smart.model')}`}
              stage={config.plan}
              models={models}
              isDisabled={disabled}
              onChange={(stage) => update({ ...config, plan: { ...config.plan, ...stage } })}
            />
          </SettingsRow>
          <SettingsRow label={t('smart.skill')} description={t('smart.skillHint')}>
            <Select
              aria-label={t('smart.skill')}
              selectedKey={configuredSkill || NO_SKILL}
              isDisabled={disabled}
              triggerClassName={ROW_SELECT_TRIGGER}
              onSelectionChange={(value) => {
                const skill = value === NO_SKILL || value == null ? '' : String(value);
                update({ ...config, plan: { ...config.plan, skill } });
              }}
            >
              <SelectItem id={NO_SKILL} textValue={t('smart.skillNone')}>{t('smart.skillNone')}</SelectItem>
              {!skillListed ? (
                <SelectItem id={configuredSkill} textValue={t('smart.skillNotFound', { skill: configuredSkill })}>
                  {t('smart.skillNotFound', { skill: configuredSkill })}
                </SelectItem>
              ) : null}
              {skills.map((name) => <SelectItem key={name} id={name} textValue={name}>{name}</SelectItem>)}
            </Select>
          </SettingsRow>
        </SettingsCard>
      </SettingsGroup>
      <SettingsGroup label={t('smart.executeStage')}>
        <SettingsCard>
          <SettingsRow label={t('smart.model')} description={t('smart.executeModelHint')}>
            <StageModelPicker
              session={session}
              label={`${t('smart.executeStage')} · ${t('smart.model')}`}
              stage={config.execute}
              models={models}
              isDisabled={disabled}
              onChange={(stage) => update({ ...config, execute: stage })}
            />
          </SettingsRow>
          <SettingsRow label={t('smart.permission')} description={t('smart.permissionHint')}>
            <SettingsValueField className="w-auto pe-2">{t('smart.permissionAuto')}</SettingsValueField>
          </SettingsRow>
        </SettingsCard>
      </SettingsGroup>
    </div>
  );
}

/** A stage's model and effort: a row trigger opening the composer's model card. */
function StageModelPicker({ session, label, stage, models, isDisabled, onChange }: {
  session: TodeXSession;
  label: string;
  stage: SmartStage;
  models: ProviderModelDescriptor[];
  isDisabled: boolean;
  onChange: (stage: SmartStage) => void;
}) {
  // What a prompt would run with: an unlisted model falls back to the default.
  const resolved = resolveSmartStage(stage, models);
  const descriptor = models.find((item) => item.id === resolved.model);
  const efforts = descriptor?.supportedReasoningEfforts ?? [];
  const displayedEffort = resolved.reasoningEffort
    ?? descriptor?.defaultReasoningEffort
    ?? (efforts.includes('medium') ? 'medium' : efforts[0])
    ?? null;
  const effortLevel = normalizeReasoningEffort(displayedEffort) ?? undefined;
  return (
    <AriaDialogTrigger>
      <AriaButton aria-label={label} isDisabled={isDisabled} className={MODEL_TRIGGER}>
        <RiCpuLine aria-hidden className={cx('size-4 shrink-0', effortLevel ? EFFORT_TEXT[effortLevel] : 'text-foreground-icon-secondary')} />
        <span className="min-w-0 truncate">{descriptor?.displayName || modelDisplayLabel(resolved.model, session.modelCatalog)}</span>
        {displayedEffort ? (
          <span className={cx('shrink-0 text-caption-1-semibold', effortLevel ? EFFORT_TEXT[effortLevel] : 'text-text-accent')}>
            · {reasoningEffortLabel(displayedEffort)}
          </span>
        ) : null}
      </AriaButton>
      <AriaPopover placement="bottom end" offset={8} className={cx(COMPOSER_POPOVER, 'w-[min(20.5rem,calc(100vw-2rem))] overflow-hidden')}>
        <AriaDialog aria-label={label} className="outline-none">
          <ModelReasoningCard
            currentModel={resolved.model}
            currentModelDescriptor={descriptor}
            modelCatalog={session.modelCatalog}
            providerModels={models}
            supportedReasoningEfforts={efforts}
            currentReasoningEffort={resolved.reasoningEffort}
            displayedReasoningEffort={displayedEffort}
            onSelectModel={(model) => {
              const next = models.find((item) => item.id === model);
              const keep = resolved.reasoningEffort && next?.supportedReasoningEfforts.includes(resolved.reasoningEffort);
              onChange({ model, reasoningEffort: keep ? resolved.reasoningEffort : next?.defaultReasoningEffort ?? null });
            }}
            onSelectReasoningEffort={(reasoningEffort) => onChange({ model: resolved.model, reasoningEffort })}
          />
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}

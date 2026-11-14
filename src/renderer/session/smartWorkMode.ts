import { useCallback, useEffect, useRef, useState } from 'react';
import type { PermissionMode, PromptAfterPlan, PromptSkillRef, ProviderDescriptor, ProviderModelDescriptor, SkillCatalogDescriptor } from '@todex/protocol/v2';
import { loadJson, saveJson } from '../lib/storage';
import { platform } from '../platform';

/**
 * Smart work mode (Claude Code): a conversation plans first with one model,
 * then, once the user approves the plan, the backend switches it to
 * implement with another model and auto-approved permissions (the prompt's
 * `afterPlan`, reported back as a `plan_handoff` provider notice). One
 * global configuration per device.
 */

export type SmartPhase = 'plan' | 'execute';

export type SmartStage = { model: string; reasoningEffort: string | null };

export type SmartWorkModeConfig = {
  /** `skill`: name of a Claude Code skill attached to plan prompts; empty for none. */
  plan: SmartStage & { skill: string };
  /** Execution always runs with auto-approved permissions. */
  execute: SmartStage;
};

export const SMART_WORK_MODE_PROVIDER = 'claude-code';
/** Execution permission mode; fixed, there is no per-config choice. */
export const SMART_EXECUTE_PERMISSION: PermissionMode = 'auto';

export const DEFAULT_SMART_WORK_MODE: SmartWorkModeConfig = {
  plan: { model: 'claude-fable-5-2', reasoningEffort: 'medium', skill: '' },
  execute: { model: 'claude-opus-5-5', reasoningEffort: 'medium' },
};

const STORAGE_KEY = `${platform.storagePrefix}.smartWorkMode.v1`;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStage(value: unknown, fallback: SmartStage): SmartStage {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const model = text(record.model) || fallback.model;
  // An explicit null keeps the provider's own default effort.
  const reasoningEffort = record.reasoningEffort === null ? null : text(record.reasoningEffort) || fallback.reasoningEffort;
  return { model, reasoningEffort };
}

/** Reads a stored configuration; anything malformed falls back to the defaults. */
export function normalizeSmartWorkModeConfig(value: unknown): SmartWorkModeConfig {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const plan = record.plan && typeof record.plan === 'object' && !Array.isArray(record.plan) ? record.plan as Record<string, unknown> : {};
  return {
    plan: { ...normalizeStage(plan, DEFAULT_SMART_WORK_MODE.plan), skill: text(plan.skill) },
    execute: normalizeStage(record.execute, DEFAULT_SMART_WORK_MODE.execute),
  };
}

/** Smart work mode needs Claude Code with Plan mode and the auto permission mode. */
export function smartWorkModeAvailable(
  provider: string | undefined,
  config: ProviderDescriptor['capabilities']['permissionConfig'] | undefined,
): boolean {
  return provider === SMART_WORK_MODE_PROVIDER && config?.supportsPlan === true && config.modes?.includes(SMART_EXECUTE_PERMISSION) === true;
}

/** The stage's model and effort, checked against the provider's model list:
 * a model the list lacks falls back to the provider default, and an effort
 * the model does not support to its default. With no list, the stage is
 * used as configured. */
export function resolveSmartStage(stage: SmartStage, models: readonly ProviderModelDescriptor[]): SmartStage {
  if (models.length === 0) return stage;
  const descriptor = models.find((item) => item.id === stage.model)
    ?? models.find((item) => item.isDefault)
    ?? models[0];
  const efforts = descriptor.supportedReasoningEfforts ?? [];
  const reasoningEffort = stage.reasoningEffort && (efforts.length === 0 || efforts.includes(stage.reasoningEffort))
    ? stage.reasoningEffort
    : stage.reasoningEffort === null ? null : descriptor.defaultReasoningEffort ?? null;
  return { model: descriptor.id, reasoningEffort };
}

export type SmartPromptFields = {
  workMode: 'plan' | 'implement';
  model: string;
  reasoningEffort: string | null;
  /** Execute phase only; plan prompts keep the conversation's mode. */
  permissionMode?: PermissionMode;
  afterPlan?: PromptAfterPlan;
  /** The configured plan skill, when the catalog lists it. */
  skill?: PromptSkillRef;
  /** The configured plan skill name the catalog did not list. */
  missingSkill?: string;
};

/** How a smart conversation's next prompt runs in `phase`. */
export function smartPromptFields(
  config: SmartWorkModeConfig,
  phase: SmartPhase,
  models: readonly ProviderModelDescriptor[],
  skills: readonly SkillCatalogDescriptor[] | undefined,
): SmartPromptFields {
  const execute = resolveSmartStage(config.execute, models);
  if (phase === 'execute') {
    return { workMode: 'implement', ...execute, permissionMode: SMART_EXECUTE_PERMISSION };
  }
  const plan = resolveSmartStage(config.plan, models);
  const skillName = config.plan.skill;
  const skill = skillName
    ? skills?.find((item) => item.name === skillName && item.valid && item.active)
      ?? skills?.find((item) => item.name === skillName && item.valid)
    : undefined;
  return {
    workMode: 'plan',
    ...plan,
    afterPlan: { model: execute.model, reasoningEffort: execute.reasoningEffort, permissionMode: SMART_EXECUTE_PERMISSION },
    ...(skill ? { skill: { resourceId: skill.resourceId, name: skill.name } } : {}),
    ...(skillName && !skill ? { missingSkill: skillName } : {}),
  };
}

/** The device's smart work mode configuration, loaded from and saved to local storage. */
export function useSmartWorkMode() {
  const [smartWorkMode, setConfig] = useState<SmartWorkModeConfig>(DEFAULT_SMART_WORK_MODE);
  const [smartWorkModeHydrated, setHydrated] = useState(false);
  const changedRef = useRef(false);
  const savesRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    void loadJson<unknown>(STORAGE_KEY, null).then((value) => {
      if (!cancelled && !changedRef.current && value != null) setConfig(normalizeSmartWorkModeConfig(value));
    }).catch(() => {
      // Keep the defaults when local storage is unavailable.
    }).finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  const setSmartWorkMode = useCallback((value: SmartWorkModeConfig) => {
    const next = normalizeSmartWorkModeConfig(value);
    changedRef.current = true;
    setConfig(next);
    // Serialize quick edits so the final configuration also wins on disk.
    savesRef.current = savesRef.current.then(() => saveJson(STORAGE_KEY, next)).catch((error) => {
      console.error('Failed to save the smart work mode configuration', error);
    });
  }, []);

  return { smartWorkMode, setSmartWorkMode, smartWorkModeHydrated };
}

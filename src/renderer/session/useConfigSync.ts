import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONFIG_SYNC_CATEGORIES,
  applyConfigSync,
  collectConfigSync,
  isConfigSyncSelectable,
  nextConfigSyncBaseline,
  planConfigSync,
  type ConfigSyncBackend,
  type ConfigSyncBaseline,
  type ConfigSyncCategory,
  type ConfigSyncEntry,
  type ConfigSyncError,
  type ConfigSyncResult,
} from '@todex/protocol/configSync';
import { loadJson, saveJson } from '../lib/storage';
import { CONFIG_SYNC_STORAGE_KEY, backendApi } from './helpers';
import type { TodeXSession } from './useTodeXSession';

export type ConfigSyncPhase = 'idle' | 'checking' | 'ready' | 'applying' | 'done';

/** Why a backend cannot take part in a sync; null when it can. */
export type ConfigSyncIneligible = 'unpaired' | 'disconnected' | null;

export type ConfigSyncTargetPlan = {
  backendId: string;
  entries: ConfigSyncEntry[];
  selected: Set<string>;
  results: Map<string, ConfigSyncResult>;
  /** Read failures on this target (the source's are in `sourceErrors`). */
  errors: ConfigSyncError[];
};

/** Where the sync page starts (e.g. "sync agent config to this backend"). */
export type ConfigSyncPreset = {
  sourceId: string;
  targetIds: string[];
  categories: ConfigSyncCategory[];
};

/** Baselines per `source → target` pair. */
type StoredBaselines = Record<string, ConfigSyncBaseline>;

const pairKey = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`;

/**
 * One-way config sync from one backend to others: pick the backends and
 * categories, check the differences, untick what should stay, then write.
 * Values read from the backends (secrets included) live in memory only; the
 * stored baseline holds content hashes.
 */
export function useConfigSync(session: TodeXSession, preset?: ConfigSyncPreset) {
  const { backendConnections, backendLinkStatus, settingsForBackend } = session;

  const ineligibility = useCallback((backendId: string): ConfigSyncIneligible => {
    const profile = backendConnections.find(item => item.id === backendId);
    // Account export and settings writes need a signed device.
    if (!profile?.deviceSecret) return 'unpaired';
    if (backendLinkStatus[backendId]?.state !== 'open') return 'disconnected';
    return null;
  }, [backendConnections, backendLinkStatus]);

  const [sourceId, setSourceIdState] = useState<string>(() => preset?.sourceId ?? backendConnections[0]?.id ?? '');
  const [targetIds, setTargetIds] = useState<string[]>(() => preset?.targetIds.filter(id => id !== preset.sourceId) ?? []);
  const [categories, setCategories] = useState<ConfigSyncCategory[]>(
    () => (preset ? CONFIG_SYNC_CATEGORIES.filter(category => preset.categories.includes(category)) : [...CONFIG_SYNC_CATEGORIES]),
  );
  const [phase, setPhase] = useState<ConfigSyncPhase>('idle');
  const [plans, setPlans] = useState<ConfigSyncTargetPlan[]>([]);
  const [sourceErrors, setSourceErrors] = useState<ConfigSyncError[]>([]);
  const [failure, setFailure] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const baselines = useRef<StoredBaselines>({});
  // Each check or apply bumps this; a run that is no longer current drops its results.
  const run = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void loadJson<StoredBaselines>(CONFIG_SYNC_STORAGE_KEY, {}).then((value) => {
      if (!cancelled) baselines.current = value && typeof value === 'object' ? value : {};
    });
    return () => { cancelled = true; };
  }, []);

  // A removed backend leaves the selection.
  useEffect(() => {
    const ids = new Set(backendConnections.map(item => item.id));
    if (!ids.has(sourceId)) setSourceIdState(backendConnections[0]?.id ?? '');
    setTargetIds(current => (current.every(id => ids.has(id)) ? current : current.filter(id => ids.has(id))));
  }, [backendConnections, sourceId]);

  const reset = useCallback(() => {
    run.current += 1;
    setPhase('idle');
    setPlans([]);
    setSourceErrors([]);
    setFailure('');
    setProgress(null);
  }, []);

  const setSourceId = useCallback((id: string) => {
    setSourceIdState(id);
    setTargetIds(current => current.filter(target => target !== id));
    reset();
  }, [reset]);

  const toggleTarget = useCallback((id: string, on: boolean) => {
    setTargetIds(current => (on ? [...new Set([...current, id])] : current.filter(target => target !== id)));
    reset();
  }, [reset]);

  const toggleCategory = useCallback((category: ConfigSyncCategory, on: boolean) => {
    setCategories(current => CONFIG_SYNC_CATEGORIES.filter(item => (item === category ? on : current.includes(item))));
    reset();
  }, [reset]);

  const backendFor = useCallback((backendId: string): ConfigSyncBackend => ({
    // Writes carrying whole skill bundles or provider exports can be slow.
    api: backendApi(settingsForBackend(backendId), { timeout: 60_000 }),
    workspace: backendLinkStatus[backendId]?.serverVersion?.scratch_workspace_root ?? '',
  }), [backendLinkStatus, settingsForBackend]);

  const check = useCallback(async () => {
    const current = ++run.current;
    setPhase('checking');
    setFailure('');
    setPlans([]);
    setProgress(null);
    try {
      const [source, ...targets] = await Promise.all([
        collectConfigSync(backendFor(sourceId), categories),
        ...targetIds.map(id => collectConfigSync(backendFor(id), categories)),
      ]);
      if (run.current !== current) return;
      setSourceErrors(source.errors);
      setPlans(targetIds.map((backendId, index) => {
        const entries = planConfigSync(source, targets[index], baselines.current[pairKey(sourceId, backendId)]);
        return {
          backendId,
          entries,
          selected: new Set(entries.filter(entry => entry.selected).map(entry => entry.key)),
          results: new Map(),
          errors: targets[index].errors,
        };
      }));
      setPhase('ready');
    } catch (error) {
      if (run.current !== current) return;
      setFailure(error instanceof Error ? error.message : String(error));
      setPhase('idle');
    }
  }, [backendFor, categories, sourceId, targetIds]);

  const toggleEntry = useCallback((backendId: string, keys: string[], on: boolean) => {
    setPlans(current => current.map((plan) => {
      if (plan.backendId !== backendId) return plan;
      const selected = new Set(plan.selected);
      for (const key of keys) {
        const entry = plan.entries.find(item => item.key === key);
        if (!entry || !isConfigSyncSelectable(entry.status)) continue;
        if (on) selected.add(key); else selected.delete(key);
      }
      return { ...plan, selected };
    }));
  }, []);

  const selectedCount = useMemo(() => plans.reduce((sum, plan) => sum + plan.selected.size, 0), [plans]);

  const apply = useCallback(async () => {
    const current = ++run.current;
    const work = plans.map(plan => ({ plan, chosen: plan.entries.filter(entry => plan.selected.has(entry.key)) }));
    const total = work.reduce((sum, item) => sum + item.chosen.length, 0);
    let done = 0;
    setPhase('applying');
    setProgress({ done: 0, total });
    const finished: ConfigSyncTargetPlan[] = [];
    for (const { plan, chosen } of work) {
      const target = backendFor(plan.backendId);
      let results: ConfigSyncResult[] = [];
      try {
        if (chosen.length) {
          const base = done;
          results = await applyConfigSync(target, chosen, (count) => {
            if (run.current === current) setProgress({ done: base + count, total });
          });
        }
        done += chosen.length;
        // Re-read the target so the baseline holds what it actually stored.
        const after = await collectConfigSync(target, [...new Set(plan.entries.map(entry => entry.category))]);
        const key = pairKey(sourceId, plan.backendId);
        baselines.current = {
          ...baselines.current,
          [key]: nextConfigSyncBaseline(baselines.current[key] ?? {}, plan.entries, results, after),
        };
        await saveJson(CONFIG_SYNC_STORAGE_KEY, baselines.current);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const reported = new Set(results.map(result => result.key));
        results = [...results, ...chosen.filter(entry => !reported.has(entry.key)).map(entry => ({ key: entry.key, ok: false, error: message }))];
      }
      finished.push({ ...plan, results: new Map(results.map(result => [result.key, result])), selected: new Set() });
    }
    if (run.current !== current) return;
    setPlans(finished);
    setProgress(null);
    setPhase('done');
  }, [backendFor, plans, sourceId]);

  return {
    sourceId,
    setSourceId,
    targetIds,
    toggleTarget,
    categories,
    toggleCategory,
    ineligibility,
    phase,
    plans,
    sourceErrors,
    failure,
    progress,
    selectedCount,
    check,
    toggleEntry,
    apply,
    reset,
  };
}

export type ConfigSyncController = ReturnType<typeof useConfigSync>;

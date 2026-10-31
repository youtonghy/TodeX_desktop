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
  type ConfigSyncResult,
  type ConfigSyncSnapshot,
} from '@todex/protocol/configSync';
import { loadJson, saveJson } from '../lib/storage';
import { configSyncRows, type ConfigSyncRow } from './configSyncView';
import { CONFIG_SYNC_STORAGE_KEY, backendApi } from './helpers';
import type { TodeXSession } from './useTodeXSession';

/** Why a backend cannot take part in a sync; null when it can. */
export type ConfigSyncIneligible = 'unpaired' | 'disconnected' | null;

/** What one side of the view has read from its backend. */
export type ConfigSyncSide = {
  backendId: string;
  snapshot: ConfigSyncSnapshot | null;
  loading: boolean;
  failure: string;
};

/** Where the sync page starts (e.g. "sync agent config to this backend"). */
export type ConfigSyncPreset = {
  sourceId: string;
  targetId: string;
  /** Categories preselected for writing; the others stay visible but unticked. */
  categories: ConfigSyncCategory[];
};

/** Baselines per `source → target` pair. */
type StoredBaselines = Record<string, ConfigSyncBaseline>;
type Side = 'source' | 'target';

const pairKey = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`;

const emptySide = (backendId: string): ConfigSyncSide => ({ backendId, snapshot: null, loading: false, failure: '' });

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * One-way config sync between two backends shown side by side: each side is
 * read as soon as it is picked, every item is lined up with its counterpart,
 * and the ticked ones are written to the target. Values read from the
 * backends (secrets included) live in memory only; the stored baseline holds
 * content hashes.
 */
export function useConfigSync(session: TodeXSession, preset?: ConfigSyncPreset, { active = true }: {
  /** Off: nothing is read yet (a wizard step that is not showing). */
  active?: boolean;
} = {}) {
  const { backendConnections, backendLinkStatus, settingsForBackend } = session;

  const ineligibility = useCallback((backendId: string): ConfigSyncIneligible => {
    const profile = backendConnections.find(item => item.id === backendId);
    // Account export and settings writes need a signed device.
    if (!profile?.deviceSecret) return 'unpaired';
    if (backendLinkStatus[backendId]?.state !== 'open') return 'disconnected';
    return null;
  }, [backendConnections, backendLinkStatus]);

  const firstOther = useCallback(
    (excluded: string | undefined) => backendConnections.find(item => item.id !== excluded)?.id ?? '',
    [backendConnections],
  );
  const [source, setSource] = useState<ConfigSyncSide>(() => emptySide(preset?.sourceId || firstOther(preset?.targetId)));
  const [target, setTarget] = useState<ConfigSyncSide>(() => emptySide(preset?.targetId || firstOther(preset?.sourceId || firstOther(undefined))));
  const [categories] = useState<ConfigSyncCategory[]>(
    () => (preset ? CONFIG_SYNC_CATEGORIES.filter(category => preset.categories.includes(category)) : [...CONFIG_SYNC_CATEGORIES]),
  );
  const [baselines, setBaselines] = useState<StoredBaselines>({});
  // The user's ticks, valid only for the rows they were made on.
  const [picks, setPicks] = useState<{ rows: ConfigSyncRow[]; keys: Set<string> } | null>(null);
  const [results, setResults] = useState<Map<string, ConfigSyncResult>>(() => new Map());
  const [applying, setApplying] = useState(false);
  // Set once a write finishes; picking, swapping or refreshing clears it.
  const [applied, setApplied] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Each read or write bumps its side's counter; one that is no longer current drops its result.
  const runs = useRef<Record<Side, number>>({ source: 0, target: 0 });

  useEffect(() => {
    let cancelled = false;
    void loadJson<StoredBaselines>(CONFIG_SYNC_STORAGE_KEY, {}).then((value) => {
      if (!cancelled) setBaselines(value && typeof value === 'object' ? value : {});
    });
    return () => { cancelled = true; };
  }, []);

  // A removed backend leaves the view.
  useEffect(() => {
    const ids = new Set(backendConnections.map(item => item.id));
    if (!ids.has(source.backendId)) setSource(emptySide(firstOther(target.backendId)));
    else if (!ids.has(target.backendId)) setTarget(emptySide(firstOther(source.backendId)));
  }, [backendConnections, firstOther, source.backendId, target.backendId]);

  // Through a ref: the session hands out new settings objects on every render,
  // and a new function each time would re-run the read effects.
  const backendFor = useRef<(backendId: string) => ConfigSyncBackend>(() => { throw new Error('config sync: no backend'); });
  backendFor.current = (backendId: string) => ({
    // Writes carrying whole skill bundles or provider exports can be slow.
    api: backendApi(settingsForBackend(backendId), { timeout: 60_000 }),
    workspace: backendLinkStatus[backendId]?.serverVersion?.scratch_workspace_root ?? '',
  });

  const read = useCallback(async (side: Side, backendId: string) => {
    const setSide = side === 'source' ? setSource : setTarget;
    const current = ++runs.current[side];
    setSide(prev => (prev.backendId === backendId ? { ...prev, loading: true, failure: '' } : prev));
    try {
      const snapshot = await collectConfigSync(backendFor.current(backendId), CONFIG_SYNC_CATEGORIES);
      if (runs.current[side] !== current) return;
      setSide(prev => (prev.backendId === backendId ? { backendId, snapshot, loading: false, failure: '' } : prev));
    } catch (error) {
      if (runs.current[side] !== current) return;
      setSide(prev => (prev.backendId === backendId ? { ...prev, loading: false, failure: errorText(error) } : prev));
    }
  }, []);

  const sourceBlocked = ineligibility(source.backendId);
  const targetBlocked = ineligibility(target.backendId);
  const sourceReadable = active && Boolean(source.backendId) && !sourceBlocked;
  const targetReadable = active && Boolean(target.backendId) && !targetBlocked;
  const sourcePending = sourceReadable && !source.snapshot && !source.failure;
  const targetPending = targetReadable && !target.snapshot && !target.failure;

  // A side reads itself once it is picked and reachable, and again when refreshed.
  useEffect(() => {
    if (sourcePending) void read('source', source.backendId);
  }, [read, source.backendId, sourcePending]);
  useEffect(() => {
    if (targetPending) void read('target', target.backendId);
  }, [read, target.backendId, targetPending]);

  const baseline = baselines[pairKey(source.backendId, target.backendId)];
  const rows = useMemo<ConfigSyncRow[]>(() => {
    if (!source.snapshot || !target.snapshot || source.backendId === target.backendId) return [];
    return configSyncRows(planConfigSync(source.snapshot, target.snapshot, baseline), target.snapshot);
  }, [baseline, source.backendId, source.snapshot, target.backendId, target.snapshot]);

  // Fresh rows start from the plan's own picks, within the preselected
  // categories. Derived, not set in an effect, so an apply in the same commit
  // that lined the rows up already sees them.
  const defaults = useMemo(
    () => new Set(rows.filter(row => row.entry?.selected && categories.includes(row.category)).map(row => row.key)),
    [categories, rows],
  );
  const selected = picks?.rows === rows ? picks.keys : defaults;

  const swap = useCallback(() => {
    runs.current.source += 1;
    runs.current.target += 1;
    setResults(new Map());
    setApplied(false);
    // Snapshots belong to backends, not to sides: swapping needs no new read.
    setSource({ ...target, loading: false, snapshot: target.loading ? null : target.snapshot });
    setTarget({ ...source, loading: false, snapshot: source.loading ? null : source.snapshot });
  }, [source, target]);

  const pick = useCallback((side: Side, backendId: string) => {
    if (backendId === (side === 'source' ? source : target).backendId) return;
    // Picking the other side's backend swaps the two.
    if (backendId === (side === 'source' ? target : source).backendId) {
      swap();
      return;
    }
    runs.current[side] += 1;
    setResults(new Map());
    setApplied(false);
    (side === 'source' ? setSource : setTarget)(emptySide(backendId));
  }, [source, swap, target]);

  /** Points both sides at once (a wizard aiming at a fixed pair). */
  const select = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === source.backendId && targetId === target.backendId) return;
    setResults(new Map());
    setApplied(false);
    // A side that keeps its backend keeps its read, finished or in flight.
    if (sourceId !== source.backendId) {
      runs.current.source += 1;
      setSource(emptySide(sourceId));
    }
    if (targetId !== target.backendId) {
      runs.current.target += 1;
      setTarget(emptySide(targetId));
    }
  }, [source.backendId, target.backendId]);

  const setSourceId = useCallback((id: string) => pick('source', id), [pick]);
  const setTargetId = useCallback((id: string) => pick('target', id), [pick]);

  const refresh = useCallback(() => {
    setResults(new Map());
    setApplied(false);
    // A side without a snapshot or failure reads again.
    setSource(prev => emptySide(prev.backendId));
    setTarget(prev => emptySide(prev.backendId));
  }, []);

  const toggleEntries = useCallback((keys: string[], on: boolean) => {
    setPicks((current) => {
      const next = new Set(current?.rows === rows ? current.keys : defaults);
      for (const key of keys) {
        const row = rows.find(item => item.key === key);
        if (!row?.entry || !isConfigSyncSelectable(row.entry.status)) continue;
        if (on) next.add(key); else next.delete(key);
      }
      return { rows, keys: next };
    });
  }, [defaults, rows]);

  const apply = useCallback(async () => {
    const entries = rows.flatMap(row => (row.entry ? [row.entry] : []));
    const chosen = entries.filter(entry => selected.has(entry.key));
    const sourceId = source.backendId;
    const targetId = target.backendId;
    const backend = backendFor.current(targetId);
    const current = ++runs.current.target;
    setApplying(true);
    setProgress({ done: 0, total: chosen.length });
    let written: ConfigSyncResult[] = [];
    try {
      if (chosen.length) {
        written = await applyConfigSync(backend, chosen, (done) => {
          if (runs.current.target === current) setProgress({ done, total: chosen.length });
        });
      }
      // Re-read the target: the baseline holds what it actually stored, and the view shows it.
      const after = await collectConfigSync(backend, CONFIG_SYNC_CATEGORIES);
      const key = pairKey(sourceId, targetId);
      const stored = await loadJson<StoredBaselines>(CONFIG_SYNC_STORAGE_KEY, {});
      const next = { ...stored, [key]: nextConfigSyncBaseline(stored?.[key] ?? {}, entries, written, after) };
      await saveJson(CONFIG_SYNC_STORAGE_KEY, next);
      setBaselines(next);
      if (runs.current.target === current) setTarget(prev => (prev.backendId === targetId ? { ...prev, snapshot: after } : prev));
    } catch (error) {
      const message = errorText(error);
      const reported = new Set(written.map(result => result.key));
      written = [...written, ...chosen.filter(entry => !reported.has(entry.key)).map(entry => ({ key: entry.key, ok: false, error: message }))];
    }
    setResults(new Map(written.map(result => [result.key, result])));
    setProgress(null);
    setApplying(false);
    setApplied(true);
  }, [rows, selected, source.backendId, target.backendId]);

  return {
    source,
    target,
    sourceBlocked,
    targetBlocked,
    setSourceId,
    setTargetId,
    select,
    swap,
    refresh,
    categories,
    rows,
    selected,
    results,
    /** Both sides are read and lined up. */
    ready: Boolean(source.snapshot && target.snapshot) && !source.loading && !target.loading && source.backendId !== target.backendId,
    applying,
    applied,
    progress,
    toggleEntries,
    apply,
  };
}

export type ConfigSyncController = ReturnType<typeof useConfigSync>;

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isReleaseVersion(version: string): boolean {
  return STABLE_VERSION.test(version) && version !== '0.0.0';
}

export function canAutoUpdate(packaged: boolean, buildVersion: string, packageVersion: string): boolean {
  return packaged && isReleaseVersion(buildVersion) && buildVersion === packageVersion;
}

export function isNewerRelease(current: string, candidate: string): boolean {
  if (!isReleaseVersion(current) || !isReleaseVersion(candidate)) return false;
  const before = current.split('.').map(BigInt);
  const after = candidate.split('.').map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (after[index] !== before[index]) return after[index] > before[index];
  }
  return false;
}

export interface ReleaseUpdater {
  checkForUpdates(): Promise<{ updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<unknown>;
}

export type UpdateStatus = 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

/** What the settings page shows; mirrored to every window on change. */
export type UpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  /** Newer release found (available, downloading, downloaded, or a failed download). */
  version?: string;
  /** Download progress, 0-100. */
  progress?: number;
  /** Epoch ms of the last completed check. */
  lastChecked?: number;
  error?: string;
  /** Download newer releases as soon as a check finds them. */
  autoDownload: boolean;
  /** Why this build cannot update itself (`unsupported` only). */
  reason?: 'dev' | 'appimage';
};

export type UpdateController = {
  getState(): UpdateState;
  /** Look for a newer release; downloads it too when `autoDownload` is on. */
  check(): Promise<UpdateState>;
  /** Download the release a check found. */
  download(): Promise<UpdateState>;
  setProgress(percent: number): void;
  setAutoDownload(enabled: boolean): void;
};

// One check/download in flight at a time, and a staged update is never
// replaced before quit. Failures land in the state instead of rejecting.
export function createUpdateController(
  updater: ReleaseUpdater,
  currentVersion: string,
  options: { autoDownload: boolean; onChange?: (state: UpdateState) => void; now?: () => number },
): UpdateController {
  const now = options.now ?? Date.now;
  let state: UpdateState = { status: 'idle', currentVersion, autoDownload: options.autoDownload };
  let pending: Promise<UpdateState> | undefined;

  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    options.onChange?.(state);
  };
  const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const run = (task: () => Promise<void>): Promise<UpdateState> => {
    if (pending) return pending;
    pending = task().then(() => state).finally(() => { pending = undefined; });
    return pending;
  };

  const downloadFound = async () => {
    set({ status: 'downloading', progress: 0, error: undefined });
    try {
      await updater.downloadUpdate();
      set({ status: 'downloaded', progress: 100 });
    } catch (error) {
      set({ status: 'error', progress: undefined, error: failure(error) });
    }
  };

  return {
    getState: () => state,
    check() {
      if (state.status === 'downloaded') return Promise.resolve(state);
      return run(async () => {
        set({ status: 'checking', error: undefined });
        let version: string | undefined;
        try {
          const result = await updater.checkForUpdates();
          version = result && isNewerRelease(currentVersion, result.updateInfo.version) ? result.updateInfo.version : undefined;
        } catch (error) {
          set({ status: 'error', version: undefined, progress: undefined, error: failure(error), lastChecked: now() });
          return;
        }
        set({ status: version ? 'available' : 'idle', version, progress: undefined, lastChecked: now() });
        if (version && state.autoDownload) await downloadFound();
      });
    },
    download() {
      if (!state.version || (state.status !== 'available' && state.status !== 'error')) return pending ?? Promise.resolve(state);
      return run(downloadFound);
    },
    setProgress(percent) {
      if (state.status !== 'downloading' || !Number.isFinite(percent)) return;
      // Whole percents only: progress events arrive far more often than that.
      const progress = Math.max(0, Math.min(100, Math.floor(percent)));
      if (progress !== state.progress) set({ progress });
    },
    setAutoDownload(enabled) {
      set({ autoDownload: enabled });
    },
  };
}

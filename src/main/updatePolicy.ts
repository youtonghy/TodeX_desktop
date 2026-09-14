// .ts extension: this module is also loaded directly by node --test.
import { mainT } from './i18n.ts';

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

// Keep one check/download in flight, and never replace a staged update before quit.
export function createUpdateCheck(updater: ReleaseUpdater, currentVersion: string) {
  let pending: Promise<string> | undefined;
  let stagedVersion: string | undefined;
  return (): Promise<string> => {
    if (stagedVersion) return Promise.resolve(mainT('main.updateDownloaded', { version: stagedVersion }));
    if (pending) return pending;
    pending = (async () => {
      const result = await updater.checkForUpdates();
      if (!result || !isNewerRelease(currentVersion, result.updateInfo.version)) {
        return mainT('main.latestStable');
      }
      await updater.downloadUpdate();
      stagedVersion = result.updateInfo.version;
      return mainT('main.updateDownloaded', { version: stagedVersion });
    })().finally(() => { pending = undefined; });
    return pending;
  };
}

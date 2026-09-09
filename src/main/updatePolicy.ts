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
    if (stagedVersion) return Promise.resolve(`版本 ${stagedVersion} 已下载，将在退出应用后安装。`);
    if (pending) return pending;
    pending = (async () => {
      const result = await updater.checkForUpdates();
      if (!result || !isNewerRelease(currentVersion, result.updateInfo.version)) {
        return '当前已是最新稳定版本。';
      }
      await updater.downloadUpdate();
      stagedVersion = result.updateInfo.version;
      return `版本 ${stagedVersion} 已下载，将在退出应用后安装。`;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}

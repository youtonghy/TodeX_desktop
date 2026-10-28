import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { app, BrowserWindow, Menu, MenuItem, net, powerMonitor } from 'electron';
import electronUpdater, { type UpdateDownloadedEvent } from 'electron-updater';
import { canAutoUpdate, createUpdateController, type ReleaseUpdater, type UpdateController, type UpdateState } from './updatePolicy';
import { MAX_SUMS_BYTES, verifyUpdateDownload } from './updateSignature';
import { mainT } from './i18n';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Waking from sleep checks again only when the last check is this old.
const RESUME_CHECK_AFTER_MS = 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/youtonghy/TodeX_desktop/releases/download';
const SIGNATURE_FETCH_TIMEOUT_MS = 30_000;

export type AutoUpdateOptions = {
  /** Fired after the installed AppImage moves to its new versioned file name. */
  onAppImageMoved?: (destination: string) => void;
  /** Persisted "download updates automatically" choice; defaults to on. */
  readAutoDownload: () => boolean;
  writeAutoDownload: (enabled: boolean) => void;
  /** The native "Check for Updates…" item: show the settings page that reports the result. */
  onShowUpdates: () => void;
};

let controller: UpdateController | undefined;
let unsupportedState: UpdateState | undefined;
let updateOptions: AutoUpdateOptions | undefined;
let updateMenuItem: MenuItem | undefined;

function buildUpdateMenuItem(): MenuItem {
  return new MenuItem({
    label: mainT('main.updateMenu'),
    submenu: [{
      label: mainT('main.checkUpdates'),
      click: () => {
        updateOptions?.onShowUpdates();
        void controller?.check();
      },
    }],
  });
}

// Rebuilds the application menu with a freshly localized update item. Used when
// the renderer switches language via the 'locale:set' IPC channel.
export function refreshUpdateMenu(): void {
  if (!updateMenuItem) return;
  const menu = new Menu();
  for (const item of Menu.getApplicationMenu()?.items ?? []) {
    if (item !== updateMenuItem) menu.append(item);
  }
  updateMenuItem = buildUpdateMenuItem();
  menu.append(updateMenuItem);
  Menu.setApplicationMenu(menu);
}

function broadcast(state: UpdateState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('updates:state', state);
  }
}

export function updateState(): UpdateState {
  return controller?.getState() ?? unsupportedState ?? { status: 'unsupported', currentVersion: app.getVersion(), autoDownload: false, reason: 'dev' };
}

export function checkForUpdates(): Promise<UpdateState> {
  return controller ? controller.check() : Promise.resolve(updateState());
}

export function downloadUpdate(): Promise<UpdateState> {
  return controller ? controller.download() : Promise.resolve(updateState());
}

export function setAutoDownload(enabled: boolean): UpdateState {
  if (!controller || !updateOptions) return updateState();
  updateOptions.writeAutoDownload(enabled);
  controller.setAutoDownload(enabled);
  // Turning it on downloads a release that an earlier check only found.
  if (enabled && controller.getState().status === 'available') void controller.download();
  return controller.getState();
}

export function installUpdate(): void {
  if (controller?.getState().status !== 'downloaded') return;
  // The relaunched app must not find this (still quitting) one holding the
  // single-instance lock, or it would hand over to it and exit.
  app.releaseSingleInstanceLock();
  // Silent on Windows, then relaunch the updated app.
  electronUpdater.autoUpdater.quitAndInstall(true, true);
}

async function fetchReleaseFile(version: string, name: string, maxBytes: number): Promise<Uint8Array> {
  const response = await net.fetch(`${RELEASES_URL}/v${version}/${name}`, { signal: AbortSignal.timeout(SIGNATURE_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${name} of v${version}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`${name} of v${version} is too large`);
  return bytes;
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Checks a downloaded update against its release's signed SHA256SUMS; throws when it does not verify. */
async function verifyDownloadedUpdate(download: UpdateDownloadedEvent): Promise<void> {
  const [sums, signature, fileSha256] = await Promise.all([
    fetchReleaseFile(download.version, 'SHA256SUMS', MAX_SUMS_BYTES),
    fetchReleaseFile(download.version, 'SHA256SUMS.sig', 1024),
    sha256File(download.downloadedFile),
  ]);
  verifyUpdateDownload({ version: download.version, fileName: basename(download.downloadedFile), fileSha256, sums, signature });
}

/**
 * The updater as the controller sees it: a download only counts once the
 * file verified against the release signature. Until then nothing installs
 * it, not even on quit.
 */
function verifiedUpdater(): ReleaseUpdater {
  const { autoUpdater } = electronUpdater;
  let downloaded: UpdateDownloadedEvent | undefined;
  autoUpdater.on('update-downloaded', (event) => { downloaded = event; });
  return {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    async downloadUpdate() {
      autoUpdater.autoInstallOnAppQuit = false;
      downloaded = undefined;
      await autoUpdater.downloadUpdate();
      const download = downloaded as UpdateDownloadedEvent | undefined;
      if (!download) throw new Error(mainT('main.updateUnverified', { reason: 'no downloaded file was reported' }));
      try {
        await verifyDownloadedUpdate(download);
      } catch (error) {
        await rm(download.downloadedFile, { force: true }).catch(() => undefined);
        throw new Error(mainT('main.updateUnverified', { reason: error instanceof Error ? error.message : String(error) }));
      }
      // Squirrel.Mac fetches the update only on quitAndInstall while this
      // stays off, which keeps an explicit install working there; elsewhere
      // the verified update may now also install when the app quits.
      if (process.platform !== 'darwin') {
        // Off until a download verified against the release signature (verifiedUpdater).
  autoUpdater.autoInstallOnAppQuit = false;
        // electron-updater registers its quit handler when a download finishes,
        // and only while install-on-quit is on (it was off until now).
        (autoUpdater as unknown as { addQuitHandler?: () => void }).addQuitHandler?.();
      }
    },
  };
}

export function startAutoUpdates(buildVersion: string, options: AutoUpdateOptions): void {
  // Both independent build identities must agree. Source runs and unversioned
  // local packages must not contact the release service, even via the menu.
  if (!canAutoUpdate(app.isPackaged, buildVersion, app.getVersion())) {
    unsupportedState = { status: 'unsupported', currentVersion: buildVersion, autoDownload: false, reason: 'dev' };
    return;
  }
  if (process.platform === 'linux' && !process.env.APPIMAGE) {
    unsupportedState = { status: 'unsupported', currentVersion: buildVersion, autoDownload: false, reason: 'appimage' };
    return;
  }

  const { autoUpdater } = electronUpdater;
  autoUpdater.setFeedURL({ provider: 'github', owner: 'youtonghy', repo: 'TodeX_desktop' });
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  // Validate the returned version before asking the updater to download it.
  autoUpdater.autoDownload = false;
  // Off until a download verified against the release signature (verifiedUpdater).
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = console;
  autoUpdater.on('error', (error) => console.warn('[updates]', error.message));
  // The launcher entry is repointed before the old process exits.
  autoUpdater.on('appimage-filename-updated', (destination) => options.onAppImageMoved?.(destination));
  autoUpdater.on('download-progress', (progress) => controller?.setProgress(progress.percent));

  updateOptions = options;
  controller = createUpdateController(verifiedUpdater(), buildVersion, {
    autoDownload: options.readAutoDownload(),
    onChange: (state) => {
      console.info('[updates]', state.status, state.version ?? '', state.error ?? '');
      broadcast(state);
    },
  });
  const run = () => { void controller?.check(); };

  // Native desktop application menu entry; it opens the settings page.
  const menu = Menu.getApplicationMenu() ?? new Menu();
  updateMenuItem = buildUpdateMenuItem();
  menu.append(updateMenuItem);
  Menu.setApplicationMenu(menu);
  const initialCheck = setTimeout(run, 15_000);
  const periodicCheck = setInterval(run, CHECK_INTERVAL_MS);
  initialCheck.unref();
  periodicCheck.unref();
  const onResume = () => {
    const lastChecked = controller?.getState().lastChecked;
    if (lastChecked && Date.now() - lastChecked >= RESUME_CHECK_AFTER_MS) run();
  };
  powerMonitor.on('resume', onResume);
  app.once('before-quit', () => {
    clearTimeout(initialCheck);
    clearInterval(periodicCheck);
    powerMonitor.off('resume', onResume);
  });
}

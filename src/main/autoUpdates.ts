import { app, BrowserWindow, Menu, MenuItem, powerMonitor } from 'electron';
import electronUpdater from 'electron-updater';
import { canAutoUpdate, createUpdateController, type UpdateController, type UpdateState } from './updatePolicy';
import { mainT } from './i18n';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Waking from sleep checks again only when the last check is this old.
const RESUME_CHECK_AFTER_MS = 60 * 60 * 1000;

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
  // Silent on Windows, then relaunch the updated app.
  electronUpdater.autoUpdater.quitAndInstall(true, true);
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
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  autoUpdater.on('error', (error) => console.warn('[updates]', error.message));
  // The launcher entry is repointed before the old process exits.
  autoUpdater.on('appimage-filename-updated', (destination) => options.onAppImageMoved?.(destination));
  autoUpdater.on('download-progress', (progress) => controller?.setProgress(progress.percent));

  updateOptions = options;
  controller = createUpdateController(autoUpdater, buildVersion, {
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

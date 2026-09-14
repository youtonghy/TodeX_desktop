import { app, dialog, Menu, MenuItem } from 'electron';
import electronUpdater from 'electron-updater';
import { canAutoUpdate, createUpdateCheck } from './updatePolicy';
import { mainT } from './i18n';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let runCheck: ((interactive: boolean) => void) | undefined;
let updateMenuItem: MenuItem | undefined;

function buildUpdateMenuItem(): MenuItem {
  return new MenuItem({
    label: mainT('main.updateMenu'),
    submenu: [{ label: mainT('main.checkUpdates'), click: () => { runCheck?.(true); } }],
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

export function startAutoUpdates(buildVersion: string): void {
  // Both independent build identities must agree. Source runs and unversioned
  // local packages must not contact the release service, even via the menu.
  if (!canAutoUpdate(app.isPackaged, buildVersion, app.getVersion())) return;
  if (process.platform === 'linux' && !process.env.APPIMAGE) return;

  const { autoUpdater } = electronUpdater;
  autoUpdater.setFeedURL({ provider: 'github', owner: 'youtonghy', repo: 'TodeX_desktop' });
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  // Validate the returned version before asking the updater to download it.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;
  autoUpdater.on('error', (error) => console.warn('[updates]', error.message));
  const check = createUpdateCheck(autoUpdater, buildVersion);

  const run = async (interactive: boolean) => {
    try {
      const message = await check();
      console.info('[updates]', message);
      if (interactive) await dialog.showMessageBox({ type: 'info', title: mainT('main.updateTitle'), message });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[updates] Check or download failed; keeping current version:', message);
      if (interactive) await dialog.showMessageBox({ type: 'error', title: mainT('main.updateFailed'), message: mainT('main.updateFailedDetail'), detail: message });
    }
  };
  runCheck = (interactive) => { void run(interactive); };

  // Native desktop application menu; no renderer or web-client API is exposed.
  const menu = Menu.getApplicationMenu() ?? new Menu();
  updateMenuItem = buildUpdateMenuItem();
  menu.append(updateMenuItem);
  Menu.setApplicationMenu(menu);
  const initialCheck = setTimeout(() => { void run(false); }, 15_000);
  const periodicCheck = setInterval(() => { void run(false); }, CHECK_INTERVAL_MS);
  initialCheck.unref();
  periodicCheck.unref();
  app.once('before-quit', () => {
    clearTimeout(initialCheck);
    clearInterval(periodicCheck);
  });
}

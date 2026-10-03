import { BrowserWindow, ipcMain, type Rectangle } from 'electron';
import { isLoopbackUrl } from '@todex/protocol/mobileParity';
import { AgentBrowser, type BrowserStore } from './browser';
import { ExecutorFailure, type ExecutorLogger } from './executorLink';
import { ExecutorManager } from './manager';
import { isStoreKeyRelevant } from './profiles';

export type AgentDesktopOptions = {
  window: () => BrowserWindow | null;
  store: BrowserStore;
  defaultServerUrl: string;
  log: ExecutorLogger;
  handle: (channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => void;
};

/**
 * Starts the agent desktop executor: one connection per paired backend that
 * has desktop tools on, and the agent browser tabs it drives.
 */
export function startAgentDesktop(options: AgentDesktopOptions): { storeChanged(key: string): void; windowClosed(): void; stop(): void } {
  const { window, store, log } = options;
  let manager: ExecutorManager | null = null;
  const browser = new AgentBrowser(
    window,
    store,
    async (profileId, _conversationId, url) => {
      const link = manager?.link(profileId);
      if (!link) throw new ExecutorFailure('EXECUTOR_FAILED', 'the backend connection is gone');
      if (isLoopbackUrl(link.profile.serverUrl)) return { url };
      throw new ExecutorFailure('TUNNEL_FAILED', 'this backend is remote and its local pages cannot be reached yet');
    },
    tabs => window()?.webContents.send('agentBrowser:tabs', tabs),
    log,
  );
  manager = new ExecutorManager(store.read, options.defaultServerUrl, {
    capabilities: ['browser'],
    invoke: (profileId, payload, signal) => browser.invoke(profileId, payload, signal),
    release: (profileId, conversationId) => browser.release(profileId, conversationId),
  }, log);
  manager.start();

  options.handle('agentBrowser:list', () => browser.tabsInfo());
  options.handle('agentBrowser:capture', (_event, key: string) => browser.capture(String(key)));
  options.handle('agentBrowser:close', (_event, key: string) => browser.close(String(key)));
  options.handle('agentBrowser:partitions', () => browser.partitionState());
  options.handle('agentBrowser:createPartition', (_event, name: string) => browser.createPartition(String(name ?? '')));
  options.handle('agentBrowser:assignPartition', (_event, workspace: string, partitionId: string) =>
    browser.assignPartition(String(workspace), String(partitionId)));
  options.handle('agentBrowser:deletePartition', (_event, partitionId: string) => browser.deletePartition(String(partitionId)));
  ipcMain.on('agentBrowser:setBounds', (event, key: unknown, bounds: unknown) => {
    if (event.sender !== window()?.webContents || typeof key !== 'string') return;
    const rect = bounds && typeof bounds === 'object' ? bounds as Rectangle : null;
    browser.setBounds(key, rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ? rect : null);
  });
  ipcMain.on('agentDesktop:refresh', () => manager?.refresh());

  return {
    storeChanged(key: string) {
      if (isStoreKeyRelevant(key)) manager?.scheduleReconcile();
    },
    /** Views die with their window; the next tool call reopens a tab. */
    windowClosed() {
      browser.closeAll();
    },
    stop() {
      manager?.stop();
      browser.closeAll();
    },
  };
}

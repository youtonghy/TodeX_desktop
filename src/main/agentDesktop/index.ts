import { BrowserWindow, ipcMain, type Rectangle } from 'electron';
import type { ExecutorCapability } from '@todex/protocol/agentDesktop';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { isLoopbackUrl } from '@todex/protocol/mobileParity';
import { V2ApiClient } from '@todex/protocol/v2';
import { mainT } from '../i18n';
import { AgentBrowser, type BrowserStore } from './browser';
import { ExecutorFailure, type ExecutorLogger } from './executorLink';
import { ComputerController, installLiveViewHandler } from './computer';
import { ExecutorManager } from './manager';
import { TunnelManager } from './tunnel';
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
  const tunnels = new TunnelManager(
    profileId => (type, payload) => manager?.link(profileId)?.send(type, payload) ?? false,
    log,
  );
  // Development aid: tunnel even when the backend is on this machine.
  const forceTunnel = process.env.TODEX_FORCE_AGENT_TUNNEL === '1';
  const browser = new AgentBrowser(
    window,
    store,
    async (profileId, conversationId, url) => {
      const link = manager?.link(profileId);
      if (!link) throw new ExecutorFailure('EXECUTOR_FAILED', 'the backend connection is gone');
      // A backend on this machine shares its localhost with the browser.
      if (isLoopbackUrl(link.profile.serverUrl) && !forceTunnel) return { url };
      const target = new URL(url);
      const remotePort = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
      let localPort: number;
      try {
        localPort = await tunnels.forward(profileId, conversationId, remotePort);
      } catch (error) {
        throw new ExecutorFailure('TUNNEL_FAILED', `cannot forward port ${remotePort}: ${error instanceof Error ? error.message : String(error)}`);
      }
      // The listener is on 127.0.0.1; `localhost` keeps its origin and still
      // resolves there.
      if (target.hostname === '[::1]') target.hostname = '127.0.0.1';
      target.port = String(localPort);
      return { url: target.toString(), tunnel: { remotePort, localPort } };
    },
    tabs => window()?.webContents.send('agentBrowser:tabs', tabs),
    log,
  );
  const computer = new ComputerController(
    window,
    store.read,
    async (profileId, conversationId) => {
      const profile = manager?.link(profileId)?.profile;
      if (!profile) return;
      const api = new V2ApiClient({ serverUrl: profile.serverUrl, device: deviceIdentityFromSecret(profile.deviceSecret) });
      await api.revokeAgentDesktop(conversationId, 'screen');
    },
    sessions => window()?.webContents.send('computer:sessions', sessions),
    () => ({ controlling: mainT('main.computerControlling'), stop: mainT('main.computerStop') }),
    log,
  );
  installLiveViewHandler(computer, window);
  manager = new ExecutorManager(store.read, options.defaultServerUrl, {
    capabilities: () => (computer.available() ? ['browser', 'screen'] : ['browser']) as ExecutorCapability[],
    invoke: (profileId, payload, signal) => (payload.tool.startsWith('computer_')
      ? computer.invoke(profileId, payload, signal)
      : browser.invoke(profileId, payload, signal)),
    release: (profileId, conversationId, capability) => {
      if (capability !== 'browser') computer.release(profileId, conversationId);
      if (capability !== 'screen') {
        browser.release(profileId, conversationId);
        tunnels.releaseConversation(profileId, conversationId);
      }
    },
    frame: (_profileId, type, payload) => tunnels.frame(type, payload),
    disconnected: profileId => {
      tunnels.disconnected(profileId);
      computer.disconnected(profileId);
    },
  }, log);
  manager.start();

  // Permissions are granted in System Settings, outside the app: notice.
  const capabilityTimer = setInterval(() => manager?.refreshCapabilities(), 15_000);
  capabilityTimer.unref?.();

  options.handle('computer:permissions', () => computer.permissions());
  options.handle('computer:requestPermissions', async () => {
    const status = await computer.requestPermissions();
    manager?.refresh();
    return status;
  });
  options.handle('computer:sessions', () => computer.sessionsInfo());

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
      clearInterval(capabilityTimer);
      manager?.stop();
      computer.stop();
      tunnels.closeAll();
      browser.closeAll();
    },
  };
}

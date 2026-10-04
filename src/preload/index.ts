import { contextBridge, ipcRenderer } from 'electron';

export type DesktopFilePayload = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
  text?: string;
};
export type GitRepositorySummary = {
  path: string;
  name: string;
  branch: string;
  files: Array<{ path: string; status: string }>;
  additions: number;
  deletions: number;
  ahead?: number;
  initialEligible?: boolean;
  error?: string;
};
export type AgentBrowserTab = {
  key: string;
  profileId: string;
  conversationId: string;
  url: string;
  title: string;
  tunnel?: { remotePort: number; localPort: number };
};
export type AgentBrowserPartitionState = {
  partitions: Array<{ id: string; name: string; createdAt: number }>;
  /** `<profileId>:<workspace id or path>` → partition id. */
  workspaces: Record<string, string>;
};
export type AgentBrowserBounds = { x: number; y: number; width: number; height: number };
export type ComputerSessionInfo = { key: string; profileId: string; conversationId: string; displayId: number; summary: string };
export type ComputerPermissions = { supported: boolean; helper: boolean; screen: string; accessibility: boolean };

export type PreviewState = { key: string; url: string; title: string; loading: boolean; error?: string };
export type PreviewPicked = { key: string; tag: string; id: string; text: string };
export type DesktopDebugLogInfo = {
  enabled: boolean;
  buildVersion: string;
  configPath: string;
  logPath: string;
  chromiumLogPath: string;
};

const api = {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key) as Promise<unknown>,
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value) as Promise<void>,
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory') as Promise<string | null>,
    openFiles: (options?: { images?: boolean }) =>
      ipcRenderer.invoke('dialog:openFiles', options) as Promise<string[]>,
  },
  fs: {
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath) as Promise<DesktopFilePayload>,
  },
  shell: {
    platform: process.platform,
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path) as Promise<void>,
    showItemInFolder: (path: string) => ipcRenderer.invoke('shell:showItemInFolder', path) as Promise<void>,
    openWith: (path: string) => ipcRenderer.invoke('shell:openWith', path) as Promise<void>,
  },
  git: {
    scan: (workspacePath: string) => ipcRenderer.invoke('git:scan', workspacePath),
    run: (workspacePath: string, action: 'commit' | 'commit-push' | 'push' | 'initial', message?: string, includeUnstaged = true) => ipcRenderer.invoke('git:run', workspacePath, action, message, includeUnstaged),
  },
  app: {
    focus: () => {
      ipcRenderer.send('window:focus');
    },
    closeWindow: () => {
      ipcRenderer.send('window:close');
    },
    onCloseRequest: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on('app:close-request', handler);
      return () => {
        ipcRenderer.removeListener('app:close-request', handler);
      };
    },
    windowChrome: (process.platform === 'darwin' ? 'hidden-inset' : 'native') as 'hidden-inset' | 'native',
  },
  locale: {
    set: (locale: string) => {
      ipcRenderer.send('locale:set', locale);
    },
  },
  theme: {
    shouldUseDark: () => ipcRenderer.invoke('theme:shouldUseDark') as Promise<boolean>,
    onUpdated: (listener: (dark: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, dark: boolean) => listener(dark);
      ipcRenderer.on('theme:updated', handler);
      return () => {
        ipcRenderer.removeListener('theme:updated', handler);
      };
    },
  },
  /** Workbench browser tabs, rendered as native views by the main process. */
  preview: {
    open: (key: string, target: { url: string } | { html: string }) => ipcRenderer.invoke('preview:open', key, target) as Promise<void>,
    reload: (key: string) => ipcRenderer.invoke('preview:reload', key) as Promise<void>,
    capture: (key: string) => ipcRenderer.invoke('preview:capture', key) as Promise<string | null>,
    inspect: (key: string, colors: { hover: string; selected: string } | null) => ipcRenderer.invoke('preview:inspect', key, colors) as Promise<void>,
    close: (key: string) => ipcRenderer.invoke('preview:close', key) as Promise<void>,
    setBounds: (key: string, bounds: AgentBrowserBounds | null) => {
      ipcRenderer.send('preview:setBounds', key, bounds);
    },
    onState: (listener: (state: PreviewState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: PreviewState) => listener(state);
      ipcRenderer.on('preview:state', handler);
      return () => {
        ipcRenderer.removeListener('preview:state', handler);
      };
    },
    onPicked: (listener: (picked: PreviewPicked) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, picked: PreviewPicked) => listener(picked);
      ipcRenderer.on('preview:picked', handler);
      return () => {
        ipcRenderer.removeListener('preview:picked', handler);
      };
    },
  },
  /** Computer Use on this Mac: permissions and active sessions. */
  computer: {
    permissions: () => ipcRenderer.invoke('computer:permissions') as Promise<ComputerPermissions>,
    requestPermissions: () => ipcRenderer.invoke('computer:requestPermissions') as Promise<ComputerPermissions>,
    sessions: () => ipcRenderer.invoke('computer:sessions') as Promise<ComputerSessionInfo[]>,
    onSessions: (listener: (sessions: ComputerSessionInfo[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessions: ComputerSessionInfo[]) => listener(sessions);
      ipcRenderer.on('computer:sessions', handler);
      return () => {
        ipcRenderer.removeListener('computer:sessions', handler);
      };
    },
  },
  agentBrowser: {
    list: () => ipcRenderer.invoke('agentBrowser:list') as Promise<AgentBrowserTab[]>,
    onTabs: (listener: (tabs: AgentBrowserTab[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, tabs: AgentBrowserTab[]) => listener(tabs);
      ipcRenderer.on('agentBrowser:tabs', handler);
      return () => {
        ipcRenderer.removeListener('agentBrowser:tabs', handler);
      };
    },
    /** Window-relative CSS pixels; `null` hides the live view. */
    setBounds: (key: string, bounds: AgentBrowserBounds | null) => {
      ipcRenderer.send('agentBrowser:setBounds', key, bounds);
    },
    capture: (key: string) => ipcRenderer.invoke('agentBrowser:capture', key) as Promise<string | null>,
    close: (key: string) => ipcRenderer.invoke('agentBrowser:close', key) as Promise<void>,
    partitions: () => ipcRenderer.invoke('agentBrowser:partitions') as Promise<AgentBrowserPartitionState>,
    createPartition: (name: string) => ipcRenderer.invoke('agentBrowser:createPartition', name) as Promise<{ id: string; name: string; createdAt: number }>,
    assignPartition: (workspace: string, partitionId: string) => ipcRenderer.invoke('agentBrowser:assignPartition', workspace, partitionId) as Promise<void>,
    deletePartition: (partitionId: string) => ipcRenderer.invoke('agentBrowser:deletePartition', partitionId) as Promise<void>,
    /** Re-check backends now, e.g. after switching desktop tools on. */
    refreshExecutors: () => {
      ipcRenderer.send('agentDesktop:refresh');
    },
  },
  debug: {
    info: () => ipcRenderer.invoke('debug:info') as Promise<DesktopDebugLogInfo>,
    log: (level: string, event: string, data?: unknown) => {
      ipcRenderer.send('debug:log', { level, event, data });
    },
  },
};

contextBridge.exposeInMainWorld('todexDesktop', api);

export type TodeXDesktopApi = typeof api;

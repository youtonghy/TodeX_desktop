import { contextBridge, ipcRenderer } from 'electron';

type WindowState = { maximized: boolean; fullScreen: boolean };

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
/** Window-relative CSS pixels of a native view. */
export type ViewBounds = { x: number; y: number; width: number; height: number };
export type PreviewBackend = { serverUrl: string; deviceSecret: string; encryptionProtocol: 'none' | 'x25519' | 'ml-kem-768'; encryptionPublicKey: string; transportVerified?: boolean };
export type PreviewState = { key: string; url: string; title: string; loading: boolean; canGoBack: boolean; error?: string };
export type PreviewPicked = { key: string; tag: string; id: string; text: string };
export type DesktopDebugLogInfo = {
  enabled: boolean;
  buildVersion: string;
  configPath: string;
  logPath: string;
  chromiumLogPath: string;
};

/** Mirror of the main process's UpdateState (src/main/updatePolicy.ts). */
export type UpdateState = {
  status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  currentVersion: string;
  version?: string;
  progress?: number;
  lastChecked?: number;
  error?: string;
  autoDownload: boolean;
  reason?: 'dev' | 'appimage';
};

const api = {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key) as Promise<unknown>,
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value) as Promise<void>,
  },
  /** Secrets sealed with the OS keychain (Electron safeStorage); `null` when
   * the key is unset. Rejects when no OS-backed encryption is available. */
  secureStore: {
    get: (key: string) => ipcRenderer.invoke('secureStore:get', key) as Promise<string | null>,
    set: (key: string, value: string | null) => ipcRenderer.invoke('secureStore:set', key, value) as Promise<void>,
    available: () => ipcRenderer.invoke('secureStore:available') as Promise<boolean>,
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory') as Promise<string | null>,
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
    minimize: () => {
      ipcRenderer.send('window:minimize');
    },
    toggleMaximize: () => {
      ipcRenderer.send('window:toggleMaximize');
    },
    /** Pops up the native application menu at window-relative (x, y). */
    popupMenu: (x?: number, y?: number) => {
      ipcRenderer.send('window:popupMenu', x, y);
    },
    windowState: () => ipcRenderer.invoke('window:getState') as Promise<WindowState>,
    onWindowState: (listener: (state: WindowState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: WindowState) => listener(state);
      ipcRenderer.on('window:state', handler);
      return () => {
        ipcRenderer.removeListener('window:state', handler);
      };
    },
    windowChrome: (process.platform === 'darwin' ? 'hidden-inset' : process.platform === 'linux' ? 'custom' : 'native') as 'hidden-inset' | 'custom' | 'native',
  },
  locale: {
    set: (locale: string) => {
      ipcRenderer.send('locale:set', locale);
    },
  },
  theme: {
    shouldUseDark: () => ipcRenderer.invoke('theme:shouldUseDark') as Promise<boolean>,
    setSource: (source: 'system' | 'light' | 'dark') => {
      ipcRenderer.send('theme:setSource', source);
    },
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
    setBackend: (backend: PreviewBackend | null) => ipcRenderer.invoke('preview:setBackend', backend) as Promise<void>,
    reload: (key: string) => ipcRenderer.invoke('preview:reload', key) as Promise<void>,
    goBack: (key: string) => ipcRenderer.invoke('preview:goBack', key) as Promise<void>,
    capture: (key: string) => ipcRenderer.invoke('preview:capture', key) as Promise<string | null>,
    inspect: (key: string, colors: { hover: string; selected: string } | null) => ipcRenderer.invoke('preview:inspect', key, colors) as Promise<void>,
    close: (key: string) => ipcRenderer.invoke('preview:close', key) as Promise<void>,
    setBounds: (key: string, bounds: ViewBounds | null) => {
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
  /** What the agent browser left here before it moved to the backend. */
  legacyAgentBrowser: {
    hasData: () => ipcRenderer.invoke('legacyAgentBrowser:hasData') as Promise<boolean>,
    clear: () => ipcRenderer.invoke('legacyAgentBrowser:clear') as Promise<void>,
  },
  debug: {
    info: () => ipcRenderer.invoke('debug:info') as Promise<DesktopDebugLogInfo>,
    log: (level: string, event: string, data?: unknown) => {
      ipcRenderer.send('debug:log', { level, event, data });
    },
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:getState') as Promise<UpdateState>,
    check: () => ipcRenderer.invoke('updates:check') as Promise<UpdateState>,
    download: () => ipcRenderer.invoke('updates:download') as Promise<UpdateState>,
    install: () => {
      ipcRenderer.send('updates:install');
    },
    setAutoDownload: (enabled: boolean) => ipcRenderer.invoke('updates:setAutoDownload', enabled) as Promise<UpdateState>,
    onState: (listener: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on('updates:state', handler);
      return () => {
        ipcRenderer.removeListener('updates:state', handler);
      };
    },
    onShow: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on('updates:show', handler);
      return () => {
        ipcRenderer.removeListener('updates:show', handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('todexDesktop', api);

export type TodeXDesktopApi = typeof api;

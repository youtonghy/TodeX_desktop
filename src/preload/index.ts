import { contextBridge, ipcRenderer } from 'electron';

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
  /** Secrets sealed with the OS keychain (Electron safeStorage); `null` when
   * the key is unset. Rejects when no OS-backed encryption is available. */
  secureStore: {
    get: (key: string) => ipcRenderer.invoke('secureStore:get', key) as Promise<string | null>,
    set: (key: string, value: string | null) => ipcRenderer.invoke('secureStore:set', key, value) as Promise<void>,
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
};

contextBridge.exposeInMainWorld('todexDesktop', api);

export type TodeXDesktopApi = typeof api;

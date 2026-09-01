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
  initialEligible?: boolean;
  error?: string;
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
  git: {
    scan: (workspacePath: string) => ipcRenderer.invoke('git:scan', workspacePath),
    run: (workspacePath: string, action: 'commit' | 'commit-push' | 'push' | 'initial', message?: string, includeUnstaged = true) => ipcRenderer.invoke('git:run', workspacePath, action, message, includeUnstaged),
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
};

contextBridge.exposeInMainWorld('todexDesktop', api);

export type TodeXDesktopApi = typeof api;

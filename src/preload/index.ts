import { contextBridge, ipcRenderer } from 'electron';

export type DesktopFilePayload = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
  text?: string;
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

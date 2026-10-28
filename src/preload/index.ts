import { contextBridge, ipcRenderer } from 'electron';
import type {
  LocalAdminStatus,
  LocalBackendConfig,
  LocalBackendConfigPatch,
  LocalBackendDiscovery,
  LocalNativeEndpoint,
  LocalPairedDevice,
  LocalPairingRequest,
  LocalDockerContainer,
  LocalSocketEvent,
} from './localBackendTypes';

import type { ContainerInfo, ContainerMountResult, ContainerProgress, ContainerSetupDone, ContainerSetupOutput, DockerEnvironment } from './containerTypes';

export type * from './localBackendTypes';
export type * from './containerTypes';

type WindowState = { maximized: boolean; fullScreen: boolean };

/**
 * A failed `todexDesktop` call: the main process's message without Electron's
 * "Error invoking remote method …" prefix, plus its `code` (e.g.
 * `signature_invalid`, `not_installed`, a Docker problem) and HTTP `status`
 * when it had them.
 */
export type TodexIpcError = Error & { name: 'TodexIpcError'; code?: string; status?: number };

/** What main's `handleIpc` resolves to (src/main/index.ts). */
type IpcEnvelope = { __todexIpc: 1; ok: true; value: unknown } | { __todexIpc: 1; ok: false; error: { message: string; code?: string; status?: number } };

/**
 * `ipcRenderer.invoke` for `handleIpc` channels. It resolves the raw envelope:
 * the page-side wrapper installed below unwraps it, so the page sees a
 * promise of `T` that rejects with a `TodexIpcError`. (Errors cannot carry
 * `code` across the context bridge, which keeps only their message.)
 */
function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown): IpcEnvelope => ({
    __todexIpc: 1,
    ok: false,
    error: { message: (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, '') },
  })) as Promise<T>;
}

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
    get: (key: string) => invoke('store:get', key) as Promise<unknown>,
    set: (key: string, value: unknown) => invoke('store:set', key, value) as Promise<void>,
  },
  /** Secrets sealed with the OS keychain (Electron safeStorage); `null` when
   * the key is unset. Rejects when no OS-backed encryption is available. */
  secureStore: {
    get: (key: string) => invoke('secureStore:get', key) as Promise<string | null>,
    set: (key: string, value: string | null) => invoke('secureStore:set', key, value) as Promise<void>,
    available: () => invoke('secureStore:available') as Promise<boolean>,
  },
  dialog: {
    openDirectory: () => invoke('dialog:openDirectory') as Promise<string | null>,
  },
  shell: {
    platform: process.platform,
    openPath: (path: string) => invoke('shell:openPath', path) as Promise<void>,
    showItemInFolder: (path: string) => invoke('shell:showItemInFolder', path) as Promise<void>,
    openWith: (path: string) => invoke('shell:openWith', path) as Promise<void>,
  },
  app: {
    focus: () => {
      ipcRenderer.send('window:focus');
    },
    /** Pastes the clipboard into the focused field as a native paste event,
     * so the page needs no clipboard read permission. */
    paste: () => {
      ipcRenderer.send('window:paste');
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
    windowState: () => invoke('window:getState') as Promise<WindowState>,
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
    shouldUseDark: () => invoke('theme:shouldUseDark') as Promise<boolean>,
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
    open: (key: string, target: { url: string } | { html: string }) => invoke('preview:open', key, target) as Promise<void>,
    setBackend: (backend: PreviewBackend | null) => invoke('preview:setBackend', backend) as Promise<void>,
    reload: (key: string) => invoke('preview:reload', key) as Promise<void>,
    goBack: (key: string) => invoke('preview:goBack', key) as Promise<void>,
    capture: (key: string) => invoke('preview:capture', key) as Promise<string | null>,
    inspect: (key: string, colors: { hover: string; selected: string } | null) => invoke('preview:inspect', key, colors) as Promise<void>,
    close: (key: string) => invoke('preview:close', key) as Promise<void>,
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
    hasData: () => invoke('legacyAgentBrowser:hasData') as Promise<boolean>,
    clear: () => invoke('legacyAgentBrowser:clear') as Promise<void>,
  },
  debug: {
    info: () => invoke('debug:info') as Promise<DesktopDebugLogInfo>,
    log: (level: string, event: string, data?: unknown) => {
      ipcRenderer.send('debug:log', { level, event, data });
    },
  },
  /** The backend on this machine (and TodeX containers sharing their socket), driven by the main process. */
  localBackend: {
    available: true,
    discover: () => invoke('localBackend:discover') as Promise<LocalBackendDiscovery>,
    nativeEndpoint: () => invoke('localBackend:nativeEndpoint') as Promise<LocalNativeEndpoint>,
    install: () => invoke('localBackend:install') as Promise<string>,
    start: () => invoke('localBackend:start') as Promise<void>,
    stop: () => invoke('localBackend:stop') as Promise<void>,
    restart: () => invoke('localBackend:restart') as Promise<void>,
    switchVersion: () => invoke('localBackend:switchVersion') as Promise<void>,
    setAutostart: (enabled: boolean) => invoke('localBackend:setAutostart', enabled) as Promise<void>,
    logTail: () => invoke('localBackend:logTail') as Promise<string>,
    status: (instance: string) => invoke('localBackend:status', instance) as Promise<LocalAdminStatus>,
    getConfig: (instance: string) => invoke('localBackend:getConfig', instance) as Promise<LocalBackendConfig>,
    setConfig: (instance: string, patch: Partial<LocalBackendConfigPatch>) => invoke('localBackend:setConfig', instance, patch) as Promise<LocalBackendConfig>,
    pairingRequests: (instance: string) => invoke('localBackend:pairingRequests', instance) as Promise<LocalPairingRequest[]>,
    decidePairing: (instance: string, requestId: string, approved: boolean, verificationCode: string) =>
      invoke('localBackend:decidePairing', instance, requestId, approved, verificationCode) as Promise<void>,
    devices: (instance: string) => invoke('localBackend:devices', instance) as Promise<LocalPairedDevice[]>,
    revokeDevice: (instance: string, deviceId: string) => invoke('localBackend:revokeDevice', instance, deviceId) as Promise<void>,
    reset: (instance: string, target: 'devices' | 'encryption') => invoke('localBackend:reset', instance, target) as Promise<{ ok: boolean; restartRequired: boolean }>,
    approveOwnPairing: (instance: string, requestId: string, verificationCode: string) =>
      invoke('localBackend:approveOwnPairing', instance, requestId, verificationCode) as Promise<void>,
    dockerApprove: (container: string, verificationCode: string) =>
      invoke('localBackend:dockerApprove', container, verificationCode) as Promise<void>,
    dockerContainers: () => invoke('localBackend:dockerContainers') as Promise<LocalDockerContainer[]>,
    onProgress: (listener: (progress: { version: string; received: number; total: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: { version: string; received: number; total: number }) => listener(progress);
      ipcRenderer.on('localBackend:progress', handler);
      return () => {
        ipcRenderer.removeListener('localBackend:progress', handler);
      };
    },
    /** Low-level WebSocket relay over the local channel; `IpcWebSocket` in the renderer wraps it. */
    socket: {
      open: (url: string) => invoke('localBackend:wsOpen', url) as Promise<number>,
      send: (id: number, data: string | Uint8Array) => {
        ipcRenderer.send('localBackend:wsSend', id, data);
      },
      close: (id: number, code?: number, reason?: string) => {
        ipcRenderer.send('localBackend:wsClose', id, code, reason);
      },
      onEvent: (listener: (event: LocalSocketEvent) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, payload: LocalSocketEvent) => listener(payload);
        ipcRenderer.on('localBackend:wsEvent', handler);
        return () => {
          ipcRenderer.removeListener('localBackend:wsEvent', handler);
        };
      },
    },
  },
  /** TodeX containers on this machine's Docker, driven by the main process. */
  container: {
    available: true,
    environment: (refresh = false) => invoke('container:environment', refresh) as Promise<DockerEnvironment>,
    list: () => invoke('container:list') as Promise<ContainerInfo[]>,
    logs: (name: string) => invoke('container:logs', name) as Promise<string>,
    create: (options: { name?: string; mounts: string[]; sshAgent?: boolean; tag?: string }) => invoke('container:create', options) as Promise<ContainerInfo>,
    start: (name: string) => invoke('container:start', name) as Promise<void>,
    stop: (name: string) => invoke('container:stop', name) as Promise<void>,
    restart: (name: string) => invoke('container:restart', name) as Promise<void>,
    upgrade: (name: string) => invoke('container:upgrade', name) as Promise<void>,
    remove: (name: string, deleteVolume: boolean) => invoke('container:remove', name, deleteVolume) as Promise<void>,
    addMount: (name: string, hostPath: string) => invoke('container:addMount', name, hostPath) as Promise<ContainerMountResult>,
    setMounts: (name: string, keepHosts: string[]) => invoke('container:setMounts', name, keepHosts) as Promise<string[]>,
    cleanup: () => invoke('container:cleanup') as Promise<{ images: number; containers: number }>,
    enablePublish: (name: string) => invoke('container:enablePublish', name) as Promise<ContainerInfo>,
    pause: (name: string) => invoke('container:pause', name) as Promise<void>,
    unpause: (name: string) => invoke('container:unpause', name) as Promise<void>,
    detectSetup: (folder: string) => invoke('container:detectSetup', folder) as Promise<string[]>,
    runSetup: (name: string, cwd: string, script: string) => invoke('container:runSetup', name, cwd, script) as Promise<string>,
    cancelSetup: (jobId: string) => invoke('container:cancelSetup', jobId) as Promise<void>,
    onSetupOutput: (listener: (output: ContainerSetupOutput) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, output: ContainerSetupOutput) => listener(output);
      ipcRenderer.on('container:setupOutput', handler);
      return () => {
        ipcRenderer.removeListener('container:setupOutput', handler);
      };
    },
    onSetupDone: (listener: (done: ContainerSetupDone) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, done: ContainerSetupDone) => listener(done);
      ipcRenderer.on('container:setupDone', handler);
      return () => {
        ipcRenderer.removeListener('container:setupDone', handler);
      };
    },
    onProgress: (listener: (progress: ContainerProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ContainerProgress) => listener(progress);
      ipcRenderer.on('container:progress', handler);
      return () => {
        ipcRenderer.removeListener('container:progress', handler);
      };
    },
  },
  updates: {
    getState: () => invoke('updates:getState') as Promise<UpdateState>,
    check: () => invoke('updates:check') as Promise<UpdateState>,
    download: () => invoke('updates:download') as Promise<UpdateState>,
    install: () => {
      ipcRenderer.send('updates:install');
    },
    setAutoDownload: (enabled: boolean) => invoke('updates:setAutoDownload', enabled) as Promise<UpdateState>,
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

// Runs in the page's world: wraps every API function so a resolved
// `IpcEnvelope` becomes the call's value or a page-world `TodexIpcError`
// (with `code` / `status`, which an Error copied across the bridge would
// lose), then defines the frozen `window.todexDesktop`. Self-contained: it is
// serialized into the page.
contextBridge.executeInMainWorld({
  func: (bridged: Record<string, unknown>) => {
    const unwrap = (value: unknown): unknown => {
      if (!value || typeof value !== 'object' || (value as { __todexIpc?: unknown }).__todexIpc !== 1) return value;
      const envelope = value as { ok: boolean; value?: unknown; error?: { message?: unknown; code?: unknown; status?: unknown } };
      if (envelope.ok) return envelope.value;
      const failure = envelope.error ?? {};
      const error = new Error(typeof failure.message === 'string' ? failure.message : 'TodeX desktop call failed') as Error & { code?: string; status?: number };
      error.name = 'TodexIpcError';
      if (typeof failure.code === 'string') error.code = failure.code;
      if (typeof failure.status === 'number') error.status = failure.status;
      throw error;
    };
    const wrap = (value: unknown): unknown => {
      if (typeof value === 'function') {
        const call = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const result = call(...args);
          return result && typeof (result as Promise<unknown>).then === 'function' ? (result as Promise<unknown>).then(unwrap) : result;
        };
      }
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, member] of Object.entries(value)) out[key] = wrap(member);
        return Object.freeze(out);
      }
      return value;
    };
    Object.defineProperty(window, 'todexDesktop', { value: wrap(bridged), enumerable: true, configurable: false, writable: false });
  },
  args: [api],
});

export type TodeXDesktopApi = typeof api & {
  /** @deprecated The desktop bridge has no `git` API any more; this optional
   * slot only keeps the browser bridge's leftover stub type-checking until it
   * is removed there. */
  git?: unknown;
};

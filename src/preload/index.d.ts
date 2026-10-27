import type { LocalDockerContainer, LocalSocketEvent, PairingEncryption, LocalAdminStatus, LocalBackendConfigPatch, LocalBackendConfig, LocalPairingRequest, LocalPairedDevice, LocalDaemonStatus, LocalBackendDiscovery, LocalNativeEndpoint } from './localBackendTypes';

import type { ContainerInfo, ContainerMountResult, ContainerPrefs, ContainerProgress, ContainerSetupDone, ContainerSetupOutput, DockerEnvironment } from './containerTypes';

export type { ContainerInfo, ContainerMountResult, ContainerPrefs, ContainerProgress, ContainerSetupDone, ContainerSetupOutput, DockerEnvironment };
export type { LocalDockerContainer, LocalSocketEvent, PairingEncryption, LocalAdminStatus, LocalBackendConfigPatch, LocalBackendConfig, LocalPairingRequest, LocalPairedDevice, LocalDaemonStatus, LocalBackendDiscovery };

export type TodeXDesktopApi = {
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  secureStore: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string | null) => Promise<void>;
    /** Whether OS-backed encryption is available, i.e. `set` can succeed. */
    available: () => Promise<boolean>;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
  };
  shell: {
    platform: string;
    openPath: (path: string) => Promise<void>;
    showItemInFolder: (path: string) => Promise<void>;
    openWith: (path: string) => Promise<void>;
  };
  git: {
    scan: (workspacePath: string) => Promise<GitRepositorySummary[]>;
    run: (workspacePath: string, action: 'commit' | 'commit-push' | 'push' | 'initial', message?: string, includeUnstaged?: boolean) => Promise<{ output: string }>;
  };
  app: {
    focus: () => void;
    paste: () => void;
    closeWindow: () => void;
    onCloseRequest: (listener: () => void) => () => void;
    /** Window controls for the renderer-drawn title bar (`windowChrome: 'custom'`). */
    minimize: () => void;
    toggleMaximize: () => void;
    popupMenu: (x?: number, y?: number) => void;
    windowState: () => Promise<{ maximized: boolean; fullScreen: boolean }>;
    onWindowState: (listener: (state: { maximized: boolean; fullScreen: boolean }) => void) => () => void;
    /** `custom`: frameless window whose title bar the renderer draws (Linux). */
    windowChrome: 'hidden-inset' | 'custom' | 'native';
  };
  locale: {
    set: (locale: string) => void;
  };
  theme: {
    shouldUseDark: () => Promise<boolean>;
    setSource: (source: 'system' | 'light' | 'dark') => void;
    onUpdated: (listener: (dark: boolean) => void) => () => void;
  };
  preview: {
    open: (key: string, target: { url: string } | { html: string }) => Promise<void>;
    /** Where the preview's loopback requests are forwarded; null loads them on this machine. */
    setBackend: (backend: PreviewBackend | null) => Promise<void>;
    reload: (key: string) => Promise<void>;
    goBack: (key: string) => Promise<void>;
    capture: (key: string) => Promise<string | null>;
    inspect: (key: string, colors: { hover: string; selected: string } | null) => Promise<void>;
    close: (key: string) => Promise<void>;
    setBounds: (key: string, bounds: ViewBounds | null) => void;
    onState: (listener: (state: PreviewState) => void) => () => void;
    onPicked: (listener: (picked: PreviewPicked) => void) => () => void;
  };
  legacyAgentBrowser: {
    hasData: () => Promise<boolean>;
    clear: () => Promise<void>;
  };
  debug: {
    info: () => Promise<DesktopDebugLogInfo>;
    log: (level: string, event: string, data?: unknown) => void;
  };
  /** The backend on this machine (and TodeX containers sharing their socket), driven by the main process. */
  localBackend: {
    /** False in the browser bridge (no local IPC there). */
    available: boolean;
    discover: () => Promise<LocalBackendDiscovery>;
    /** Whether the native daemon runs, its TCP port and (when it has one) its IPC socket. */
    nativeEndpoint: () => Promise<LocalNativeEndpoint>;
    /** Downloads the backend build matching this desktop (latest for dev builds); resolves its path. */
    install: () => Promise<string>;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    restart: () => Promise<void>;
    /** Restarts the daemon from the managed build of this desktop's version. */
    switchVersion: () => Promise<void>;
    setAutostart: (enabled: boolean) => Promise<void>;
    logTail: () => Promise<string>;
    status: (instance: string) => Promise<LocalAdminStatus>;
    getConfig: (instance: string) => Promise<LocalBackendConfig>;
    setConfig: (instance: string, patch: Partial<LocalBackendConfigPatch>) => Promise<LocalBackendConfig>;
    pairingRequests: (instance: string) => Promise<LocalPairingRequest[]>;
    decidePairing: (instance: string, requestId: string, approved: boolean, verificationCode: string) => Promise<void>;
    devices: (instance: string) => Promise<LocalPairedDevice[]>;
    revokeDevice: (instance: string, deviceId: string) => Promise<void>;
    reset: (instance: string, target: 'devices' | 'encryption') => Promise<{ ok: boolean; restartRequired: boolean }>;
    /** Approves a pairing request this app itself created over the instance's socket. */
    approveOwnPairing: (instance: string, requestId: string, verificationCode: string) => Promise<void>;
    /** `docker exec … pair approve <code>` in a running TodeX container (no shared socket). */
    dockerApprove: (container: string, verificationCode: string) => Promise<void>;
    dockerContainers: () => Promise<LocalDockerContainer[]>;
    onProgress: (listener: (progress: { version: string; received: number; total: number }) => void) => () => void;
    socket: {
      open: (url: string) => Promise<number>;
      send: (id: number, data: string | Uint8Array) => void;
      close: (id: number, code?: number, reason?: string) => void;
      onEvent: (listener: (event: LocalSocketEvent) => void) => () => void;
    };
  };
  /** TodeX containers on this machine's Docker (Settings → TodeX Container, container workspaces). */
  container: {
    /** False in the browser bridge. */
    available: boolean;
    /** Docker CLI, daemon, Compose and image checks; cached until `refresh`. */
    environment: (refresh?: boolean) => Promise<DockerEnvironment>;
    list: () => Promise<ContainerInfo[]>;
    /** The last 500 log lines. */
    logs: (name: string) => Promise<string>;
    /** Creates an instance (free name and port when omitted) mounting `mounts`, starts it and waits until healthy. */
    create: (options: { name?: string; mounts: string[]; sshAgent?: boolean; tag?: string }) => Promise<ContainerInfo>;
    start: (name: string) => Promise<void>;
    stop: (name: string) => Promise<void>;
    restart: (name: string) => Promise<void>;
    /** Pulls the image and recreates the container. */
    upgrade: (name: string) => Promise<void>;
    /** Removes the container and its settings; the home volume only with `deleteVolume`. */
    remove: (name: string, deleteVolume: boolean) => Promise<void>;
    /** Makes a host folder visible in the container (recreating it when a mount is added); resolves its container path. */
    addMount: (name: string, hostPath: string) => Promise<ContainerMountResult>;
    /** Keeps only these host folders mounted (never none); resolves the removed ones. */
    setMounts: (name: string, keepHosts: string[]) => Promise<string[]>;
    /** Runs the automatic cleanup now. */
    cleanup: () => Promise<{ images: number; containers: number }>;
    /** Publishes a socket-only container on a free host port (recreating it), for when its socket refuses this user. */
    enablePublish: (name: string) => Promise<ContainerInfo>;
    /** Freezes the container (`docker pause`); processes and memory are kept. */
    pause: (name: string) => Promise<void>;
    unpause: (name: string) => Promise<void>;
    /** Which setup-template marker files (lockfiles, `.gitmodules`, …) a host folder has. */
    detectSetup: (folder: string) => Promise<string[]>;
    /** Runs a bash script in the container at `cwd` as the todex user; resolves a job id for the setup events. */
    runSetup: (name: string, cwd: string, script: string) => Promise<string>;
    cancelSetup: (jobId: string) => Promise<void>;
    onSetupOutput: (listener: (output: ContainerSetupOutput) => void) => () => void;
    onSetupDone: (listener: (done: ContainerSetupDone) => void) => () => void;
    onProgress: (listener: (progress: ContainerProgress) => void) => () => void;
  };
  /** Release auto-updates (GitHub Releases), driven by the main process. */
  updates: {
    getState: () => Promise<UpdateState>;
    check: () => Promise<UpdateState>;
    download: () => Promise<UpdateState>;
    /** Quits and installs a downloaded update, then relaunches. */
    install: () => void;
    setAutoDownload: (enabled: boolean) => Promise<UpdateState>;
    onState: (listener: (state: UpdateState) => void) => () => void;
    /** The native "Check for Updates…" menu item asks for the settings page. */
    onShow: (listener: () => void) => () => void;
  };
};

export type UpdateStatus = 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
/** Mirror of the main process's UpdateState (src/main/updatePolicy.ts). */
export type UpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  version?: string;
  progress?: number;
  lastChecked?: number;
  error?: string;
  autoDownload: boolean;
  reason?: 'dev' | 'appimage';
};

/** Window-relative CSS pixels of a native view. */
export type ViewBounds = { x: number; y: number; width: number; height: number };
export type PreviewBackend = {
  serverUrl: string;
  deviceSecret: string;
  encryptionProtocol: 'none' | 'x25519' | 'ml-kem-768';
  encryptionPublicKey: string;
  transportVerified?: boolean;
};
export type PreviewState = { key: string; url: string; title: string; loading: boolean; canGoBack: boolean; error?: string };
export type PreviewPicked = { key: string; tag: string; id: string; text: string };
export type DesktopDebugLogInfo = {
  enabled: boolean;
  buildVersion: string;
  configPath: string;
  logPath: string;
  chromiumLogPath: string;
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

declare global {
  interface Window {
    todexDesktop: TodeXDesktopApi;
  }
}

export {};

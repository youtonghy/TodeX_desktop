export type DesktopFilePayload = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
  text?: string;
};

export type TodeXDesktopApi = {
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
    openFiles: (options?: { images?: boolean }) => Promise<string[]>;
  };
  fs: {
    readFile: (filePath: string) => Promise<DesktopFilePayload>;
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
    closeWindow: () => void;
    onCloseRequest: (listener: () => void) => () => void;
    windowChrome: 'hidden-inset' | 'native';
  };
  locale: {
    set: (locale: string) => void;
  };
  theme: {
    shouldUseDark: () => Promise<boolean>;
    onUpdated: (listener: (dark: boolean) => void) => () => void;
  };
  agentBrowser: {
    list: () => Promise<AgentBrowserTab[]>;
    onTabs: (listener: (tabs: AgentBrowserTab[]) => void) => () => void;
    setBounds: (key: string, bounds: AgentBrowserBounds | null) => void;
    capture: (key: string) => Promise<string | null>;
    close: (key: string) => Promise<void>;
    partitions: () => Promise<AgentBrowserPartitionState>;
    createPartition: (name: string) => Promise<{ id: string; name: string; createdAt: number }>;
    assignPartition: (workspace: string, partitionId: string) => Promise<void>;
    deletePartition: (partitionId: string) => Promise<void>;
    refreshExecutors: () => void;
  };
  debug: {
    info: () => Promise<DesktopDebugLogInfo>;
    log: (level: string, event: string, data?: unknown) => void;
  };
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

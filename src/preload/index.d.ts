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
  preview: {
    open: (key: string, target: { url: string } | { html: string }) => Promise<void>;
    reload: (key: string) => Promise<void>;
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

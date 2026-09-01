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
  git: {
    scan: (workspacePath: string) => Promise<GitRepositorySummary[]>;
    run: (workspacePath: string, action: 'commit' | 'commit-push' | 'push' | 'initial', message?: string, includeUnstaged?: boolean) => Promise<{ output: string }>;
  };
  theme: {
    shouldUseDark: () => Promise<boolean>;
    onUpdated: (listener: (dark: boolean) => void) => () => void;
  };
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

declare global {
  interface Window {
    todexDesktop: TodeXDesktopApi;
  }
}

export {};

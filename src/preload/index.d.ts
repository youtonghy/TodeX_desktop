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
  theme: {
    shouldUseDark: () => Promise<boolean>;
    onUpdated: (listener: (dark: boolean) => void) => () => void;
  };
};

declare global {
  interface Window {
    todexDesktop: TodeXDesktopApi;
  }
}

export {};

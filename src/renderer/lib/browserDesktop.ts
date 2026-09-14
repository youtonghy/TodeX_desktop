import type { TodeXDesktopApi } from '../../preload/index';
import { t } from '../i18n';

const PREFIX = 'todex.browser.';

function readLocal(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(`${PREFIX}${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: unknown): void {
  const storageKey = `${PREFIX}${key}`;
  if (value === undefined) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

export function installBrowserDesktopBridge(): void {
  if (window.todexDesktop) {
    return;
  }

  const api: TodeXDesktopApi = {
    store: {
      get: async (key) => readLocal(key),
      set: async (key, value) => {
        writeLocal(key, value);
      },
    },
    dialog: {
      openDirectory: async () => null,
      openFiles: async () => [],
    },
    fs: {
      readFile: async () => {
        throw new Error(t('storage.browserReadFile'));
      },
    },
    app: {
      focus: () => window.focus(),
    },
    locale: {
      set: () => undefined,
    },
    git: {
      scan: async () => [],
      run: async () => ({ output: t('storage.browserGit') }),
    },
    theme: {
      shouldUseDark: async () => window.matchMedia('(prefers-color-scheme: dark)').matches,
      onUpdated: (listener) => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => listener(media.matches);
        media.addEventListener('change', handler);
        return () => media.removeEventListener('change', handler);
      },
    },
    debug: {
      info: async () => ({ enabled: false, buildVersion: 'browser', configPath: '', logPath: '', chromiumLogPath: '' }),
      log: () => undefined,
    },
  };

  window.todexDesktop = api;
}

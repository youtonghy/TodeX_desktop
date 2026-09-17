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
    shell: {
      platform: navigator.userAgent.includes('Mac') ? 'darwin' : navigator.userAgent.includes('Win') ? 'win32' : 'linux',
      openPath: async () => {
        throw new Error(t('storage.browserShell'));
      },
      showItemInFolder: async () => {
        throw new Error(t('storage.browserShell'));
      },
      openWith: async () => {
        throw new Error(t('storage.browserShell'));
      },
    },
    app: {
      focus: () => window.focus(),
      closeWindow: () => window.close(),
      // Browsers reserve Cmd+W, so the DOM fallback only fires where the host
      // delivers the key (e.g. embedded webviews).
      onCloseRequest: (listener) => {
        const onKeyDown = (event: KeyboardEvent) => {
          if (!event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (event.key.toLowerCase() !== 'w') return;
          event.preventDefault();
          listener();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
      },
      windowChrome: 'native' as const,
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

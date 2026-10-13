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
    // A browser tab has no OS keychain; secrets are refused rather than kept
    // in plaintext localStorage (only absent keys read back).
    secureStore: {
      get: async () => null,
      set: async (_key, value) => {
        if (value !== null) throw new Error(t('history.keyFailed'));
      },
    },
    dialog: {
      openDirectory: async () => null,
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
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      popupMenu: () => undefined,
      windowState: async () => ({ maximized: false, fullScreen: false }),
      onWindowState: () => () => undefined,
      windowChrome: 'native' as const,
    },
    locale: {
      set: () => undefined,
    },
    git: {
      scan: async () => [],
      run: async () => ({ output: t('storage.browserGit') }),
    },
    theme: browserTheme(),
    // No Electron: no native preview or agent browser views, no executor.
    preview: {
      open: async () => {
        throw new Error(t('storage.browserShell'));
      },
      reload: async () => undefined,
      capture: async () => null,
      inspect: async () => undefined,
      close: async () => undefined,
      setBounds: () => undefined,
      onState: () => () => undefined,
      onPicked: () => () => undefined,
    },
    legacyAgentBrowser: {
      hasData: async () => false,
      clear: async () => undefined,
    },
    debug: {
      info: async () => ({ enabled: false, buildVersion: 'browser', configPath: '', logPath: '', chromiumLogPath: '' }),
      log: () => undefined,
    },
  };

  window.todexDesktop = api;
}

/** The system scheme from the media query, unless the user picked light or dark. */
function browserTheme(): TodeXDesktopApi['theme'] {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set<(dark: boolean) => void>();
  let source: 'system' | 'light' | 'dark' = 'system';
  const dark = () => (source === 'system' ? media.matches : source === 'dark');
  media.addEventListener('change', () => listeners.forEach((listener) => listener(dark())));
  return {
    shouldUseDark: async () => dark(),
    setSource: (next) => {
      source = next;
      listeners.forEach((listener) => listener(dark()));
    },
    onUpdated: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

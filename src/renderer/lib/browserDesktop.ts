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
      available: async () => false,
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
      // No native paste here: read the clipboard and replay it as a paste
      // event on the focused element.
      paste: () => {
        void navigator.clipboard?.readText().then((text) => {
          const data = new DataTransfer();
          data.setData('text/plain', text);
          document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }).catch(() => undefined);
      },
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
      setBackend: async () => undefined,
      reload: async () => undefined,
      goBack: async () => undefined,
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
    // A browser tab cannot run or reach a local backend over IPC.
    localBackend: (() => {
      const unavailable = async (): Promise<never> => {
        throw new Error(t('localBackend.unavailable'));
      };
      return {
        available: false,
        discover: unavailable,
        nativeEndpoint: async () => ({ running: false, port: null, ipcPath: null }),
        install: unavailable,
        start: unavailable,
        stop: unavailable,
        restart: unavailable,
        switchVersion: unavailable,
        setAutostart: unavailable,
        logTail: unavailable,
        status: unavailable,
        getConfig: unavailable,
        setConfig: unavailable,
        pairingRequests: unavailable,
        decidePairing: unavailable,
        devices: unavailable,
        revokeDevice: unavailable,
        reset: unavailable,
        approveOwnPairing: unavailable,
        dockerApprove: unavailable,
        dockerContainers: async () => [],
        onProgress: () => () => undefined,
        socket: {
          open: unavailable,
          send: () => undefined,
          close: () => undefined,
          onEvent: () => () => undefined,
        },
      };
    })(),
    // Docker on this machine is only reachable from the desktop's main process.
    container: (() => {
      const unavailable = async (): Promise<never> => {
        throw new Error(t('container.unavailable'));
      };
      return {
        available: false,
        environment: unavailable,
        list: async () => [],
        logs: unavailable,
        create: unavailable,
        start: unavailable,
        stop: unavailable,
        restart: unavailable,
        upgrade: unavailable,
        remove: unavailable,
        addMount: unavailable,
        setMounts: unavailable,
        cleanup: unavailable,
        onProgress: () => () => undefined,
      };
    })(),
    updates: (() => {
      const state = { status: 'unsupported' as const, currentVersion: __TODEX_BUILD_VERSION__, autoDownload: false, reason: 'dev' as const };
      return {
        getState: async () => state,
        check: async () => state,
        download: async () => state,
        install: () => undefined,
        setAutoDownload: async () => state,
        onState: () => () => undefined,
        onShow: () => () => undefined,
      };
    })(),
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

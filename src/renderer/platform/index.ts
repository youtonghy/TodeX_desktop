// Desktop implementation of the shared platform interface (./types.ts) over
// the preload bridge. Members read `window.todexDesktop` when used: the dev
// demo installs its browser stand-in after the modules load.
import { isContainerProfile, useContainerProfileIds } from '../session/containerProfileIds';
import { createIndexedDbHistoryCacheStore } from '../lib/historyCacheIdb';
import type { Platform } from './types';

export type * from './types';

const bridge = () => window.todexDesktop;

function hostOs(): Platform['os'] {
  // Optional: shortcuts read it while modules load, before the demo bridge exists.
  const os = window.todexDesktop?.shell.platform;
  return os === 'darwin' || os === 'win32' || os === 'linux' ? os : 'other';
}

export const platform: Platform = {
  kind: 'desktop',
  productName: 'TodeX Desktop',
  storagePrefix: 'todex.desktop',
  get os() { return hostOs(); },
  get windowChrome() { return bridge().app.windowChrome; },
  reservedNewShortcuts: false,
  store: {
    get: (key) => bridge().store.get(key),
    set: (key, value) => bridge().store.set(key, value),
  },
  app: {
    focus: () => bridge().app.focus(),
    paste: () => bridge().app.paste(),
    // The main process forwards Cmd+W as a close request; unhandled, it
    // closes the window so the platform shortcut keeps working.
    onCloseShortcut: (handler) => bridge().app.onCloseRequest(() => {
      if (!handler()) bridge().app.closeWindow();
    }),
  },
  theme: {
    shouldUseDark: () => bridge().theme.shouldUseDark(),
    setSource: (source) => bridge().theme.setSource(source),
    onUpdated: (listener) => bridge().theme.onUpdated(listener),
  },
  backendUrlProblem: () => null,
  files: {
    pickDirectory: () => bridge().dialog.openDirectory(),
    openPath: (path) => bridge().shell.openPath(path),
    openWith: (path) => bridge().shell.openWith(path),
    reveal: (path) => bridge().shell.showItemInFolder(path),
  },
  get preview() { return bridge().preview; },
  historyCache: createIndexedDbHistoryCacheStore(),
  get legacyAgentBrowser() { return bridge().legacyAgentBrowser; },
  containers: {
    useProfileIds: useContainerProfileIds,
    isContainerProfile,
  },
};

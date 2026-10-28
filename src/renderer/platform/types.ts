// The one interface shared renderer code uses to reach its host. Desktop
// (Electron) and web each implement it in ./index.ts and ./slots.tsx; this
// file is identical in both clients (see scripts/check-shared-sync.mjs).
// Optional members are capabilities: absent means the feature is hidden.
import type { ComponentType, ReactNode } from 'react';
import type { BackendConnectionProfile } from '@todex/protocol/todex';
import type { TodeXSession } from '../session/useTodeXSession';

export type ThemeSource = 'system' | 'light' | 'dark';
/** `hidden-inset`: macOS traffic lights over the page; `custom`: the app
 * draws its own title bar (frameless Linux); `native`: the host's frame. */
export type WindowChrome = 'hidden-inset' | 'custom' | 'native';

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

/** Native page views for the Workbench browser tab (desktop). */
export type PlatformPreview = {
  open: (key: string, target: { url: string } | { html: string }) => Promise<void>;
  /** Where loopback requests are forwarded; null loads them on this machine. */
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

/** A self-hosted web deployment's fixed backends (`GET /api/config`). */
export type PlatformDeployment = {
  backends: { id: string; name: string }[];
  /** Exactly the deployed backends; stored profiles of them keep their keys. */
  profiles: <Profile extends BackendConnectionProfile>(stored: Profile[], template: Profile) => Profile[];
};

export type Platform = {
  kind: 'desktop' | 'web';
  /** About title and the device name sent when pairing. */
  productName: string;
  /** Prefix of this client's own persisted keys (kept from before the shared interface). */
  storagePrefix: 'todex.desktop' | 'todex.web';
  os: 'darwin' | 'win32' | 'linux' | 'other';
  windowChrome: WindowChrome;
  /** Browsers reserve ⌘N / ⇧⌘T, so "new" shortcuts use Option there. */
  reservedNewShortcuts: boolean;
  store: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  app: {
    focus: () => void;
    /** Pastes through the host when the page cannot read the clipboard. */
    paste?: () => void;
    /** Runs `handler` for the close shortcut (⌘W / Ctrl+W); it returns true
     * when it closed something. Unhandled, the desktop closes the window. */
    onCloseShortcut: (handler: () => boolean) => () => void;
  };
  theme: {
    shouldUseDark: () => Promise<boolean>;
    setSource: (source: ThemeSource) => void;
    onUpdated: (listener: (dark: boolean) => void) => () => void;
  };
  /** Why this client refuses to reach `serverUrl` (null when it may). */
  backendUrlProblem: (serverUrl: string) => string | null;
  /** Backends pinned by a self-hosted web server. */
  deployment?: PlatformDeployment;
  /** This machine's filesystem through its file manager. */
  files?: {
    pickDirectory: () => Promise<string | null>;
    openPath: (path: string) => Promise<void>;
    openWith: (path: string) => Promise<void>;
    reveal: (path: string) => Promise<void>;
  };
  preview?: PlatformPreview;
  /** Removes every key and secret this client stored (web "clear local data"). */
  clearLocalData?: () => Promise<void>;
  /** Data of the removed built-in agent browser (desktop). */
  legacyAgentBrowser?: { hasData: () => Promise<boolean>; clear: () => Promise<void> };
  /** Backend profiles that reach a TodeX container on this machine. */
  containers: {
    useProfileIds: () => ReadonlySet<string>;
    isContainerProfile: (profile: Pick<BackendConnectionProfile, 'id' | 'serverUrl'>, ids: ReadonlySet<string>) => boolean;
  };
};

export type PlatformSettingsSection = {
  id: 'local-backend' | 'container';
  labelKey: 'localBackend.title' | 'container.title';
  icon: ComponentType<{ className?: string }>;
  Component: ComponentType<{ session: TodeXSession; deviceName: string }>;
};

export type ContainerWorkspaceFlowOptions = {
  session: TodeXSession;
  enabled: boolean;
  name: string;
  setName: (name: string) => void;
  deviceName: string;
  onDone: () => void;
  onOpenSettings: () => void;
};

export type BrowserPaneProps = {
  itemId: string;
  isActive: boolean;
  workspacePath?: string;
  session: TodeXSession;
  target?: { url?: string; filePath?: string };
  onTargetChange?: (target: { url?: string; filePath?: string }) => void;
};

/** Host-specific React pieces the shared screens render. */
export type PlatformSlots = {
  /** Session side effects (desktop: IPC reminders, daemon conflicts). */
  useSessionEffects: (session: TodeXSession) => void;
  /** App effects that may show a settings page (desktop: updates). */
  useAppEffects: (showSettings: (section: 'about') => void) => void;
  /** Rendered beside the app (desktop: container freezer, mount cleanup, setup notices). */
  AppOverlays: ComponentType<{ session: TodeXSession }> | null;
  settingsSections: PlatformSettingsSection[];
  /** Extra About content (desktop: updates). */
  AboutExtras: ComponentType | null;
  /** The Workbench browser tab; null hides it. */
  BrowserPane: ComponentType<BrowserPaneProps> | null;
  /** Creating container workspaces (desktop with Docker). */
  containerWorkspaces: boolean;
  useContainerWorkspaceFlow: (options: ContainerWorkspaceFlowOptions) => { body: ReactNode; footer: ReactNode };
};

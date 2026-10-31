import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RiAddLine, RiFolderAddLine, RiExpandLeftLine, RiExpandRightLine, RiGithubLine, RiLayoutLeftLine, RiLayoutRightLine } from '@remixicon/react';
import { motion, useReducedMotion } from 'motion/react';
import { Dialog, Modal as AriaModal, ModalOverlay } from 'react-aria-components';
import { Input } from '@/components/base/input/input';
import { Button } from '@/components/base/buttons/button';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { useDirection } from '@/components/foundations/direction/direction';
import { Alert } from '@/components/ui/alert';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { IconAction } from '@/components/ui/icon-action';
import { Modal } from '@/components/ui/modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToastViewport, toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { ConversationSplit, useMediaQuery } from './components/ConversationSplit';
import { useWorkbenchLayout } from './session/useWorkbenchLayout';
import { sshWorkbenchScopeKey, workbenchScopeKey } from './session/workbenchLayout';
import { createAgentBrowserWatch, takeNewAgentBrowserTab } from './session/agentBrowserTabs';
import { createRunWatch, takeNewAgentCalls, takeNewSshExecs, takeNewSubagents } from './session/sshExecTabs';
import { useTodeXSession, type TodeXSession } from './session/useTodeXSession';
import { ConversationHeaderDetails } from './components/ConversationHeaderDetails';
import { GitActionsModal } from './components/GitActionsModal';
import { DesktopAlertHost } from './components/DesktopAlertHost';
import { SshLoginPrompter } from './components/ssh/SshLoginPrompter';
import { SessionNoticeToasts } from './components/SessionNoticeToasts';
import { useNoticeToast } from './components/NoticeToast';
import { AppSidebar } from './components/AppSidebar';
import { AppIcon } from './components/AppIcon';
import { ChatPanel } from './screens/ChatPanel';
import { HistoryRecoveryNotice } from './components/HistoryRecoveryNotice';
import { Field } from './components/Field';
import { connectionStateLabel, conversationDisplayTitle, firstPromptText, createWorkspaceDirectory, fetchWorkspaceDirectorySnapshot, isNoneWorkspaceId, isPrivateConversation, isUnmountedPathError } from './session/helpers';
import { PrivateConversationDialog } from './components/PrivateConversationDialog';
import { pickedHostPathToBackend } from './session/hostPaths';
import { WorkspaceMountHint } from './components/WorkspaceMountHint';
import { platform } from './platform';
import { useTimelineSelector } from './session/conversationStore';
import { slots } from './platform/slots';
import { isLocalBackendUrl } from '@todex/protocol/mobileParity';
import { mapHostPathToBackend } from '@todex/protocol/pathMapping';
import { isWorkbenchTab, panelFromRoute, type DesktopPanel, type OpenPanelOptions, type WorkbenchItem, type WorkbenchRequest, type WorkbenchTab } from './lib/panels';
import type { RemoteFilesBinding } from './session/fileSources';
import { ShortcutHint, useAppShortcuts, useShortcutHintTracking } from './lib/shortcuts';
import { useT } from './i18n';
import type { SettingsSectionRequest } from './screens/SettingsPanel';
import { useAppearance } from './lib/appearance';
import { useFeatureModes } from './session/featureToggles';

// Secondary surfaces load on demand so the main bundle stays small.
const SettingsPanel = lazy(() => import('./screens/SettingsPanel').then((module) => ({ default: module.SettingsPanel })));
const AsidePanel = lazy(() => import('./screens/AsidePanel').then((module) => ({ default: module.AsidePanel })));
const WorkbenchPanel = lazy(() => import('./screens/WorkbenchPanel').then((module) => ({ default: module.WorkbenchPanel })));
const ProfilePanel = lazy(() => import('./screens/ProfilePanel').then((module) => ({ default: module.ProfilePanel })));
const KanbanPanel = lazy(() => import('./screens/KanbanPanel').then((module) => ({ default: module.KanbanPanel })));
const SshPanel = lazy(() => import('./screens/SshPanel').then((module) => ({ default: module.SshPanel })));

function PanelFallback() {
  const t = useT();
  return <div className="flex h-full min-h-24 items-center justify-center text-body-regular text-text-secondary">{t('app.loading')}</div>;
}
const panelFallback = <PanelFallback />;

function PanelError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <Alert status="danger" title={t('app.panelFailed')} description={error instanceof Error ? error.message : String(error)} />
      <Button size="small" variant="secondary" onClick={onRetry}>{t('app.panelRetry')}</Button>
    </div>
  );
}

/** A panel that fails to load or render shows its error in place instead of
 * unmounting the whole app (a blank window); `resetKey` (the conversation or
 * panel shown) retries once it changes. */
function PanelBoundary({ children, resetKey }: { children: ReactNode; resetKey?: unknown }) {
  return (
    <ErrorBoundary label="panel" resetKey={resetKey} fallback={(error, reset) => <PanelError error={error} onRetry={reset} />}>
      <Suspense fallback={panelFallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/** The compact-layout drawer motion from the BoardUI AI chat shell. */
const DRAWER_EASE = [0.42, 0, 0.58, 1] as const;
/** Sidebar width plus its 12px inset: how far the workspace slides aside. */
const DRAWER_OFFSET = 272;

/** Compact layout: the right panel slides in from the inline end over a
 * dimmed backdrop (the AI chat shell's mobile panel drawer). */
function AsideSheet({ isOpen, onOpenChange, label, children }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  const direction = useDirection();
  return (
    <ModalOverlay
      dir={direction}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
      className="window-no-drag fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 ease-out data-[entering]:opacity-0 data-[exiting]:opacity-0 motion-reduce:transition-none"
    >
      <AriaModal
        className={cx(
          'absolute inset-y-0 end-0 flex w-[min(26rem,calc(100%-12px))] outline-none',
          'transition-transform duration-300 ease-in-out motion-reduce:transition-none',
          'data-[entering]:translate-x-[110%] data-[exiting]:translate-x-[110%]',
          'rtl:data-[entering]:-translate-x-[110%] rtl:data-[exiting]:-translate-x-[110%]',
        )}
      >
        <Dialog aria-label={label} className="flex size-full flex-col bg-background-full p-3 shadow-sidebar outline-none">
          <div className="min-h-0 flex-1 overflow-hidden rounded-3xl bg-background-secondary-default">{children}</div>
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}

// Names kept from before the shared platform interface, so layouts survive.
const LAYOUT_AUTO_SAVE_ID = platform.kind === 'desktop' ? 'todex-desktop-app-layout' : 'todex.web.appLayout.v1';
const LAYOUT_OPEN_STORAGE_KEY = `${platform.storagePrefix}.layoutOpen.v3`;

type LayoutOpenState = {
  sidebarOpen: boolean;
  asideOpen: boolean;
};

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function readLayoutOpen(): LayoutOpenState {
  // A first web visit on a wide screen starts with the right panel open.
  const wideDefault = platform.kind === 'web' && typeof window !== 'undefined' && window.matchMedia('(min-width: 1025px)').matches;
  try {
    const raw = window.localStorage.getItem(LAYOUT_OPEN_STORAGE_KEY);
    if (!raw) return { sidebarOpen: true, asideOpen: wideDefault };
    const parsed = JSON.parse(raw) as Partial<LayoutOpenState>;
    return {
      sidebarOpen: parsed.sidebarOpen !== false,
      asideOpen: parsed.asideOpen === true,
    };
  } catch {
    return { sidebarOpen: true, asideOpen: wideDefault };
  }
}

function writeLayoutOpen(next: LayoutOpenState) {
  try {
    window.localStorage.setItem(LAYOUT_OPEN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    window.dispatchEvent(new CustomEvent('todex-storage-error', { detail: { key: LAYOUT_OPEN_STORAGE_KEY } }));
  }
}

export function App() {
  const t = useT();
  const themeSource = useAppearance().theme;
  const [panel, setPanel] = useState<DesktopPanel | null>(null);
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<SettingsSectionRequest>();
  const panelScopeRef = useRef('');
  const [slashCommand, setSlashCommand] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(() => readLayoutOpen().sidebarOpen);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [gitOpen, setGitOpen] = useState(false);

  const [panelMotion, setPanelMotion] = useState(false);
  const panelMotionTimerRef = useRef<number | null>(null);
  // Panel sizes are driven by inline flex-grow; the CSS transition is gated on
  // [data-panel-motion] so handle drags and window resizes stay instant.
  const animatePanelMotion = useCallback(() => {
    if (document.querySelector('[data-separator="active"]')) return;
    setPanelMotion(true);
    if (panelMotionTimerRef.current !== null) window.clearTimeout(panelMotionTimerRef.current);
    panelMotionTimerRef.current = window.setTimeout(() => {
      panelMotionTimerRef.current = null;
      setPanelMotion(false);
    }, 400);
  }, []);

  const persistSidebarOpen = useCallback((open: boolean) => {
    if (open !== sidebarOpen) animatePanelMotion();
    setSidebarOpen(open);
    writeLayoutOpen({ ...readLayoutOpen(), sidebarOpen: open });
  }, [animatePanelMotion, sidebarOpen]);

  const openPanelHandlerRef = useRef<(name: string, params?: OpenPanelOptions) => void>(() => {});
  const forwardOpenPanel = useCallback((name: string, params?: OpenPanelOptions) => openPanelHandlerRef.current(name, params), []);
  const session = useTodeXSession(forwardOpenPanel);
  // Workspace a private conversation is being started in (its dialog is open).
  const [privateWorkspaceId, setPrivateWorkspaceId] = useState<string | null>(null);
  const privateAgents = useMemo(
    () => (privateWorkspaceId ? session.privateConversationAgents(privateWorkspaceId) : undefined),
    // Re-read when the agent catalogs change while the dialog is open.
    [privateWorkspaceId, session.privateConversationAgents, session.v2Providers],
  );
  const openPrivateConversation = () => {
    // Private conversations need a real workspace.
    if (!session.activeWorkspaceId || isNoneWorkspaceId(session.activeWorkspaceId)) return;
    setPrivateWorkspaceId(session.activeWorkspaceId);
  };
  const { AppOverlays } = slots;
  slots.useSessionEffects(session);
  // The SSH view swaps the main content but keeps sidebar and Workbench; its
  // Workbench tabs (SSH terminals, remote files) live in a per-backend scope.
  const sshActive = panel === 'ssh';
  // Backend the SSH view acts on: picked there, else the focused backend
  // (also each time the view opens again).
  const [sshBackendPick, setSshBackendPick] = useState('');
  useEffect(() => {
    if (!sshActive) setSshBackendPick('');
  }, [sshActive]);
  const sshBackendId = sshBackendPick && session.backendConnections.some((profile) => profile.id === sshBackendPick)
    ? sshBackendPick
    : session.activeBackendConnectionId;
  // The task board, like the terminal, takes the conversation's place in the shell.
  const kanbanActive = panel === 'kanban';
  // So does the user's profile page.
  const profileActive = panel === 'profile';
  // A full page in the conversation's place: it sits on the full surface and
  // the Workbench stays hidden.
  const pageActive = kanbanActive || profileActive;
  const features = useFeatureModes();
  const terminalEnabled = features.terminal !== 'off';
  const kanbanEnabled = features.kanban !== 'off';
  // Turning a feature off leaves its view, however it was opened.
  useEffect(() => {
    if ((panel === 'ssh' && !terminalEnabled) || (panel === 'kanban' && !kanbanEnabled)) setPanel(null);
  }, [panel, terminalEnabled, kanbanEnabled]);
  const scopeKey = !session.hydrated || !session.workbenchSharingHydrated ? ''
    : sshActive ? sshWorkbenchScopeKey(sshBackendId || session.settings.serverUrl)
      : workbenchScopeKey(
        session.workbenchSharing,
        session.activeWorkspace?.backendConnectionId || session.activeBackendConnectionId || session.settings.serverUrl,
        session.activeWorkspace?.id || '', session.activeConversation?.id || '',
      );
  // A private conversation's own workbench (tabs, layout) stays in memory.
  const workbenchEphemeral = !sshActive && session.workbenchSharing === 'conversation' && isPrivateConversation(session.activeConversation);
  const layout = useWorkbenchLayout(scopeKey, workbenchEphemeral);
  const { isOpen: asideOpen, setOpen: setAsideOpenRaw, tab: workbenchTab, setTab: setWorkbenchTab,
    target: panelTarget, setTarget: setPanelTarget } = layout;
  // The aside is actually on screen; live views stop streaming otherwise.
  const asideShown = Boolean(scopeKey) && layout.hydrated && asideOpen && !pageActive;
  const persistAsideOpen = useCallback((open: boolean) => {
    if (open !== asideOpen) animatePanelMotion();
    setAsideOpenRaw(open);
  }, [animatePanelMotion, asideOpen, setAsideOpenRaw]);
  // The right panel can take the whole width, leaving the conversation as a rail.
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const toggleChatCollapsed = useCallback((collapsed: boolean) => {
    animatePanelMotion();
    setChatCollapsed(collapsed);
  }, [animatePanelMotion]);
  // At this width the right panel becomes a sheet; the split is desktop-only.
  const compactLayout = useMediaQuery('(max-width: 1024px)');
  // Below 769px the sidebar leaves the layout for a push drawer.
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { if (!isMobile) setMobileNavOpen(false); }, [isMobile]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);
  const direction = useDirection();
  const reduceMotion = useReducedMotion();
  const drawerTransition = { duration: reduceMotion ? 0 : 0.325, ease: DRAWER_EASE };

  useNoticeToast(
    session.versionMismatch
      ? t('conn.versionMismatch', { backend: session.serverVersion?.version ?? '?', app: __TODEX_BUILD_VERSION__ })
      : null,
    { variant: 'warning', timeout: 12000 },
  );

  const openPanel = useCallback((name: string, params?: OpenPanelOptions) => {
    // About and CLI management (with each agent's skills and MCPs, accounts
    // and cleanup) are settings categories now; their routes still open them.
    const section = name === 'About' ? 'about'
      : name === 'CliManager' || name === 'AgentProviders' || name === 'Cleanup' || name === 'Capabilities' ? 'cli' : null;
    if (section) {
      setSettingsSectionRequest({ section, at: Date.now() });
      setPanel('settings');
      return;
    }
    const next = panelFromRoute(name);
    if (!next) {
      return;
    }
    panelScopeRef.current = scopeKey;
    setSlashCommand(params?.command);
    setPanelTarget({ url: params?.url, filePath: params?.filePath });
    setPanel(next);
    if (isWorkbenchTab(next)) {
      setWorkbenchTab(next);
    }
    if (next !== 'settings' && next !== 'profile') {
      persistAsideOpen(true);
    }
  }, [persistAsideOpen, scopeKey, setPanelTarget, setWorkbenchTab]);
  openPanelHandlerRef.current = openPanel;

  useEffect(() => {
    setPanel(current => current && ['settings', 'profile', 'kanban', 'ssh'].includes(current) ? current : null);
    setSlashCommand(undefined);
  }, [scopeKey]);

  const consumePanelTarget = useCallback(() => setPanelTarget({}), [setPanelTarget]);

  const [workbenchRequests, setWorkbenchRequests] = useState<WorkbenchRequest[]>([]);
  const [workbenchItems, setWorkbenchItems] = useState<WorkbenchItem[]>([]);
  const workbenchRequestIdRef = useRef(0);
  const queueWorkbenchRequest = useCallback((build: (id: number) => WorkbenchRequest) => {
    workbenchRequestIdRef.current += 1;
    const request = build(workbenchRequestIdRef.current);
    setWorkbenchRequests(current => [...current, request]);
  }, []);
  const workbenchRequestsHandled = useCallback((lastId: number) => {
    setWorkbenchRequests(current => current.filter(request => request.id > lastId));
  }, []);
  const openSshTerminal = useCallback((host: string) => {
    queueWorkbenchRequest(id => ({ id, kind: 'ssh-terminal', host }));
    persistAsideOpen(true);
  }, [persistAsideOpen, queueWorkbenchRequest]);
  const openRemoteFiles = useCallback((remote: RemoteFilesBinding) => {
    queueWorkbenchRequest(id => ({ id, kind: 'remote-files', remote }));
    persistAsideOpen(true);
  }, [persistAsideOpen, queueWorkbenchRequest]);
  const openBrowserTab = useCallback((url: string) => {
    queueWorkbenchRequest(id => ({ id, kind: 'browser', url }));
    persistAsideOpen(true);
  }, [persistAsideOpen, queueWorkbenchRequest]);
  const closeWorkbenchItem = useCallback((itemId: string) => queueWorkbenchRequest(id => ({ id, kind: 'close', itemId })), [queueWorkbenchRequest]);
  const toggleSshView = useCallback(() => {
    // Git actions belong to the conversation view, not the SSH view.
    setGitOpen(false);
    setPanel(current => current === 'ssh' ? null : 'ssh');
  }, []);
  // Requests and the reported tab list belong to the scope that produced them.
  useEffect(() => {
    setWorkbenchRequests([]);
    setWorkbenchItems([]);
  }, [scopeKey]);
  // An agent `ssh_exec` call or a subagent that starts in the viewed
  // conversation opens the side panel on the conversation's single Agent SSH
  // log or Subagents tab, creating it on first use. Runs already in the runtime
  // when the conversation became the viewed one (history, replay) are only
  // recorded, and the SSH view (another Workbench scope) records without opening.
  // Checked on every runtime change (in the session store, so the app does
  // not re-render for each streamed delta), and when the view changes.
  const sshExecWatchRef = useRef(createRunWatch());
  const subagentWatchRef = useRef(createRunWatch());
  const agentCallWatchRef = useRef(createRunWatch());
  const agentBrowserWatchRef = useRef(createAgentBrowserWatch());
  const viewedConversationId = session.activeConversation?.id ?? '';
  const viewedRecovering = viewedConversationId ? session.recoveringConversations[viewedConversationId] === true : false;
  useEffect(() => {
    const check = () => {
      const viewedRuntime = viewedConversationId ? session.stores.runtime.get()[viewedConversationId] : undefined;
      const open = (kind: 'ssh-exec' | 'subagents' | 'agent-calls' | 'agent-browser') => {
        if (sshActive || !scopeKey) return;
        queueWorkbenchRequest(id => ({ id, kind, conversationId: viewedConversationId }));
        persistAsideOpen(true);
      };
      if (takeNewSshExecs(sshExecWatchRef.current, viewedConversationId, viewedRuntime, viewedRecovering).length) open('ssh-exec');
      if (takeNewSubagents(subagentWatchRef.current, viewedConversationId, viewedRuntime, viewedRecovering).length) open('subagents');
      // A child conversation the viewed conversation's agent starts through
      // the `todex_agents` MCP server opens the Agent calls tab, like subagents.
      if (takeNewAgentCalls(agentCallWatchRef.current, viewedConversationId, viewedRuntime, viewedRecovering).length) open('agent-calls');
      // A new agent-browser tab lifetime (its first successful call, or one
      // after the tab closed) opens the live view; lifetimes present when the
      // conversation became the viewed one, failed calls, and a panel the user
      // closed during the same lifetime do not.
      if (takeNewAgentBrowserTab(agentBrowserWatchRef.current, viewedConversationId, viewedRuntime, viewedRecovering)) open('agent-browser');
    };
    check();
    return session.stores.runtime.subscribe(check);
  }, [persistAsideOpen, queueWorkbenchRequest, scopeKey, session.stores, sshActive, viewedConversationId, viewedRecovering]);
  const changeWorkbenchTab = useCallback((next: WorkbenchTab) => {
    setWorkbenchTab(next);
    setPanelTarget({});
  }, [setWorkbenchTab, setPanelTarget]);

  // Cmd+W closes the active workbench tab when the aside is showing (the
  // desktop otherwise closes the window, as the platform shortcut does).
  const workbenchCloseRef = useRef<() => boolean>(() => false);
  const asideOpenRef = useRef(asideOpen);
  asideOpenRef.current = asideOpen;
  useEffect(() => platform.app.onCloseShortcut(() => asideOpenRef.current && workbenchCloseRef.current()), []);

  slots.useAppEffects((section) => {
    setSettingsSectionRequest({ section, at: Date.now() });
    setPanel('settings');
  });

  useEffect(() => {
    const reportStorageFailure = () => toast.danger(t('app.storageQuota'));
    window.addEventListener('todex-storage-error', reportStorageFailure);
    return () => window.removeEventListener('todex-storage-error', reportStorageFailure);
  }, []);

  useShortcutHintTracking();
  useAppShortcuts({
    toggleSidebar: () => persistSidebarOpen(!sidebarOpen),
    toggleAside: () => {
      if (!scopeKey) return;
      persistAsideOpen(!asideOpen);
    },
    gitActions: () => {
      if (sshActive) return;
      setGitOpen((open) => !open);
    },
    kanban: () => {
      if (!kanbanEnabled) return;
      if (panel === 'kanban') {
        setPanel(null);
        return;
      }
      setPanel('kanban');
      persistAsideOpen(false);
    },
    sshTerminal: () => {
      if (terminalEnabled) toggleSshView();
    },
    newConversation: () => {
      if (!session.activeWorkspaceId) return;
      session.createConversation(session.activeWorkspaceId);
      setPanel(null);
    },
    newWorkspace: () => {
      setEditingWorkspaceId(null);
      setCreateOpen(true);
    },
    newPrivateConversation: openPrivateConversation,
  });

  useEffect(() => platform.theme.onUpdated(applyTheme), []);

  // Hand the light/dark/system choice to the platform, then read the result
  // (`onUpdated` covers later system changes while following the system).
  useEffect(() => {
    platform.theme.setSource(themeSource);
    void platform.theme.shouldUseDark().then(applyTheme);
  }, [themeSource]);

  // The same title the sidebar shows (not the raw provider-name default).
  const activeFirstPrompt = useTimelineSelector(session.stores,
    (timeline) => (session.activeConversation ? firstPromptText(timeline, session.activeConversation.id) : ''), Object.is);
  const windowConversationTitle = session.activeConversation ? conversationDisplayTitle(session.activeConversation, activeFirstPrompt) : '';
  useEffect(() => {
    const status = connectionStateLabel(session.connectionState);
    document.title = windowConversationTitle ? `TodeX · ${windowConversationTitle} · ${status}` : `TodeX · ${status}`;
  }, [windowConversationTitle, session.connectionState]);

  const insetChrome = platform.windowChrome === 'hidden-inset';
  const settingsOpen = panel === 'settings';
  // The "no recovery key" notice opened settings to set one up.
  const [historyRecoverySetup, setHistoryRecoverySetup] = useState(false);
  useEffect(() => { if (!settingsOpen) setHistoryRecoverySetup(false); }, [settingsOpen]);
  // A refused connection's re-pair action opened settings to pair again.
  const [repairPairing, setRepairPairing] = useState(false);
  useEffect(() => { if (!settingsOpen) setRepairPairing(false); }, [settingsOpen]);
  // A category to show (About, from the update menu or the About route).
  useEffect(() => { if (!settingsOpen) setSettingsSectionRequest(undefined); }, [settingsOpen]);
  const modalPanel = settingsOpen;
  const overlayPanel = panelScopeRef.current === scopeKey && panel && panel !== 'kanban' && panel !== 'profile' && panel !== 'ssh' && !modalPanel && !isWorkbenchTab(panel) ? panel : null;

  const asideContent = (
    !scopeKey || !layout.hydrated ? null : (
      <PanelBoundary resetKey={`${scopeKey}:${overlayPanel ?? workbenchTab}`}>
        {overlayPanel ? (
          <AsidePanel
            session={session}
            panel={overlayPanel}
            slashCommand={slashCommand}
            onBack={() => setPanel(workbenchTab)}
          />
        ) : (
          <WorkbenchPanel key={scopeKey} scopeKey={scopeKey} ephemeral={workbenchEphemeral} shown={asideShown} session={session} tab={workbenchTab} target={panelTarget} onTabChange={changeWorkbenchTab} onTargetConsumed={consumePanelTarget} closeRequestRef={workbenchCloseRef}
            sshMode={sshActive} sshBackendId={sshActive ? sshBackendId : undefined} requests={workbenchRequests} onRequestsHandled={workbenchRequestsHandled} onItemsChange={sshActive ? setWorkbenchItems : undefined} />
        )}
      </PanelBoundary>
    )
  );
  // macOS hidden-inset chrome: with the sidebar in its drawer the traffic
  // lights sit over the conversation header, so it keeps clear of them.
  const clearLights = insetChrome && isMobile;
  const headerHint = 'absolute -top-1.5 -end-1.5 z-10';
  const header = (
    <header className={cx('window-drag flex min-h-13 shrink-0 items-center gap-2 px-3 py-2', clearLights && 'ps-[84px]')}>
      {isMobile ? (
        <IconAction icon={RiLayoutLeftLine} aria-label={t('app.openSidebar')} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)} />
      ) : (
        <span className="relative inline-flex shrink-0">
          <IconAction icon={RiLayoutLeftLine} aria-label={sidebarOpen ? t('app.collapseSidebar') : t('app.expandSidebar')} onClick={() => persistSidebarOpen(!sidebarOpen)} />
          <ShortcutHint id="toggleSidebar" className={headerHint} />
        </span>
      )}
      {sshActive || pageActive ? (
        <span className="min-w-0 flex-1 truncate text-body-semibold text-text-primary">{t(kanbanActive ? 'sidebar.kanban' : profileActive ? 'app.profile' : 'ssh.title')}</span>
      ) : (
        <ConversationHeaderDetails session={session} title={session.activeConversation?.title ?? t('app.conversation')} gitOpen={gitOpen} onOpenGit={() => setGitOpen(true)} />
      )}
      <div className="flex shrink-0 items-center gap-1">
        {!sshActive && !pageActive ? (
          <span className="relative inline-flex shrink-0">
            <IconAction icon={RiGithubLine} aria-label={t('app.githubActions')} onClick={() => setGitOpen(true)} />
            <ShortcutHint id="gitActions" className={headerHint} />
          </span>
        ) : null}
        {asideShown && !compactLayout ? (
          <IconAction icon={RiExpandLeftLine} aria-label={t('app.collapseChat')} tooltip onClick={() => toggleChatCollapsed(true)} />
        ) : null}
        {pageActive ? null : <span className="relative inline-flex shrink-0">
          <IconAction icon={RiLayoutRightLine} aria-label={asideOpen ? t('app.closeAside') : t('app.openAside')} aria-expanded={asideOpen} onClick={() => persistAsideOpen(!asideOpen)} />
          <ShortcutHint id="toggleAside" className={headerHint} />
        </span>}
      </div>
    </header>
  );
  const mainContent = (
    profileActive ? (
      <PanelBoundary>
        <ProfilePanel session={session} />
      </PanelBoundary>
    ) : kanbanActive ? (
      <PanelBoundary>
        <KanbanPanel session={session} onOpenConversation={() => setPanel(null)} />
      </PanelBoundary>
    ) : sshActive ? (
      <PanelBoundary>
        <SshPanel
          session={session}
          backendId={sshBackendId}
          onBackendChange={setSshBackendPick}
          scopeKey={scopeKey}
          workbenchItems={workbenchItems}
          onOpenSshTerminal={openSshTerminal}
          onOpenRemoteFiles={openRemoteFiles}
          onCloseWorkbenchItem={closeWorkbenchItem}
          onOpenBrowser={slots.BrowserPane ? openBrowserTab : undefined}
        />
      </PanelBoundary>
    ) : session.historyEncryption.recoveryNoticeVisible ? (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <div className="shrink-0 px-5 pt-3">
          <HistoryRecoveryNotice
            className="mx-auto max-w-2xl"
            onSetup={() => { setHistoryRecoverySetup(true); setPanel('settings'); }}
            onDismiss={session.historyEncryption.dismissRecoveryNotice}
          />
        </div>
        <div className="min-h-0 flex-1"><PanelBoundary resetKey={session.activeConversation?.id}><ChatPanel session={session} /></PanelBoundary></div>
      </div>
    ) : <PanelBoundary resetKey={session.activeConversation?.id}><ChatPanel session={session} /></PanelBoundary>
  );

  // The conversation container of the BoardUI AI chat shell: header row, then
  // the chat.
  const chatContainer = (
    <main className={cx(
      'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl',
      // The board's columns and the profile's cards are secondary panels, so
      // those pages sit on the full surface.
      pageActive ? 'border border-border-button-default bg-background-full' : 'bg-background-secondary-default',
    )}>
      {header}
      <div className="min-h-0 flex-1">{mainContent}</div>
    </main>
  );

  // Stands in for the header + conversation while the right panel takes the width.
  const chatRail = (
    <div className="window-drag flex h-full flex-col items-center gap-1 rounded-3xl bg-background-secondary-default py-2">
      <IconAction icon={RiLayoutLeftLine} aria-label={sidebarOpen ? t('app.collapseSidebar') : t('app.expandSidebar')} onClick={() => persistSidebarOpen(!sidebarOpen)} />
      <IconAction icon={RiExpandRightLine} aria-label={t('app.expandChat')} tooltip tooltipPlacement="right" onClick={() => toggleChatCollapsed(false)} />
    </div>
  );

  // The split's right panel; its inline-end padding is the page frame, so the
  // grip handle can sit at the frame edge while the panel is closed.
  const desktopAside = (
    <div className="h-full min-h-0 pe-3">
      <div className="h-full min-h-0 overflow-hidden rounded-3xl bg-background-secondary-default">{asideContent}</div>
    </div>
  );

  const sidebar = (
    <AppSidebar
      session={session}
      open={sidebarOpen}
      onOpenChange={persistSidebarOpen}
      mobile={isMobile}
      onCloseMobile={() => setMobileNavOpen(false)}
      onCreateWorkspace={() => { setEditingWorkspaceId(null); setCreateOpen(true); }}
      onEditWorkspace={(workspaceId) => { setEditingWorkspaceId(workspaceId); setCreateOpen(true); }}
      onCreateConversation={(workspaceId = session.activeWorkspaceId, options) => {
        if (!workspaceId) {
          return;
        }
        session.createConversation(workspaceId, options);
        setPanel(null);
      }}
      onCreatePrivateConversation={openPrivateConversation}
      onCreateScheduledConversation={async (workspaceId, at, options) => {
        const record = await session.createScheduledConversation(workspaceId, at, options);
        if (record) setPanel(null);
        return Boolean(record);
      }}
      onOpenSettings={() => setPanel('settings')}
      onOpenProfile={() => { setPanel('profile'); persistAsideOpen(false); }}
      onOpenKanban={() => { setPanel('kanban'); persistAsideOpen(false); }}
      onOpenTerminal={toggleSshView}
      terminalActive={sshActive}
      kanbanActive={kanbanActive}
      profileActive={profileActive}
      onSelectConversation={() => setPanel(current => current === 'ssh' || current === 'kanban' || current === 'profile' ? null : current)}
    />
  );
  const drawerOpen = isMobile && mobileNavOpen;

  // Page ground with a 12px frame: floating sidebar panel, then the
  // conversation (beside the right panel on wide windows).
  const shell = (
    <div className={cx('relative flex h-full min-h-0 gap-3 overflow-hidden p-3', !compactLayout && 'pe-0')}>
      {insetChrome ? <div aria-hidden="true" className="window-drag absolute inset-x-0 top-0 z-30 h-3" /> : null}
      {isMobile ? (
        // The drawer sidebar waits beneath the workspace; opening it slides
        // the workspace aside while the sidebar fades and scales in.
        <div className="absolute inset-y-0 start-0 z-10 flex w-68 py-3 ps-1.5" aria-hidden={!mobileNavOpen} inert={!mobileNavOpen}>
          <motion.div
            initial={false}
            animate={{ scale: mobileNavOpen ? 1 : 0.94, opacity: mobileNavOpen ? 1 : 0 }}
            transition={drawerTransition}
            className={cx('h-full w-65 origin-left will-change-transform rtl:origin-right', mobileNavOpen ? 'pointer-events-auto' : 'pointer-events-none')}
          >
            {sidebar}
          </motion.div>
        </div>
      ) : sidebar}
      <motion.div
        initial={false}
        animate={{ x: drawerOpen ? (direction === 'rtl' ? -DRAWER_OFFSET : DRAWER_OFFSET) : 0, borderRadius: drawerOpen ? 32 : 0 }}
        transition={drawerTransition}
        className={cx('relative z-20 flex min-h-0 min-w-0 flex-1 bg-background-full', isMobile && 'overflow-hidden will-change-transform')}
      >
        {isMobile ? (
          <motion.button
            type="button"
            aria-label={t('app.collapseSidebar')}
            tabIndex={mobileNavOpen ? 0 : -1}
            onClick={() => setMobileNavOpen(false)}
            initial={false}
            animate={{ opacity: mobileNavOpen ? 1 : 0 }}
            transition={drawerTransition}
            className={cx('absolute inset-0 z-50 cursor-pointer rounded-[inherit] bg-black/10', mobileNavOpen ? 'pointer-events-auto' : 'pointer-events-none')}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1" inert={drawerOpen}>
          {compactLayout ? chatContainer : (
            <ConversationSplit
              autoSaveId={LAYOUT_AUTO_SAVE_ID}
              aside={desktopAside}
              asideOpen={asideShown}
              onAsideOpenChange={persistAsideOpen}
              chatCollapsed={chatCollapsed}
              onChatCollapsedChange={setChatCollapsed}
              rail={chatRail}
              chat={chatContainer}
            />
          )}
        </div>
      </motion.div>
      {compactLayout ? (
        <AsideSheet isOpen={asideShown} onOpenChange={persistAsideOpen} label={t('settings.aside')}>{asideContent}</AsideSheet>
      ) : null}
    </div>
  );

  const closePanel = (name: DesktopPanel) => (open: boolean) => {
    if (!open) setPanel((current) => current === name ? null : current);
  };

  return (
    <div className="h-full bg-background-full text-text-primary" data-panel-motion={panelMotion || undefined}>
      <ToastViewport />
      <SessionNoticeToasts lastError={session.lastError} health={session.connectionHealth}
        scope={`${session.activeBackendConnectionId}:${session.settings.serverUrl}`}
        onRepair={() => { setRepairPairing(true); setPanel('settings'); }} />
      <DesktopAlertHost />
      {session.hydrated ? <SshLoginPrompter session={session} /> : null}
      {AppOverlays ? <AppOverlays session={session} /> : null}
      {session.hydrated ? (
        shell
      ) : (
        <div className="window-drag flex h-full flex-col items-center justify-center gap-3">
          <AppIcon className="size-16" />
          <p className="text-title-3-semibold text-text-primary">TodeX</p>
          <p className="text-body-regular text-text-secondary">{t('app.loadingSettings')}</p>
        </div>
      )}
      {/* A fixed height keeps the dialog still when switching sections; each
          category page scrolls on its own beside the category list. */}
      <Modal isOpen={settingsOpen} onOpenChange={closePanel('settings')} title={t('app.settings')} size="4xl" className="h-[min(90vh,48rem)]" bodyClassName="flex min-h-0 flex-col overflow-hidden px-0 pb-0">
        <PanelBoundary><SettingsPanel session={session} historyRecoverySetup={historyRecoverySetup} repairPairing={repairPairing} sectionRequest={settingsSectionRequest} /></PanelBoundary>
      </Modal>
      <GitActionsModal key={session.activeConversation?.id} session={session} isOpen={gitOpen} onOpenChange={setGitOpen} />
      <PrivateConversationDialog
        isOpen={privateWorkspaceId !== null}
        agents={privateAgents}
        onConfirm={async (options) => {
          if (!privateWorkspaceId) return false;
          const record = await session.createPrivateConversation(privateWorkspaceId, options);
          if (record) setPanel(null);
          return Boolean(record);
        }}
        onClose={() => setPrivateWorkspaceId(null)}
      />
      {createOpen ? <CreateWorkspaceModal
        key={editingWorkspaceId ?? 'create'}
        session={session}
        workspace={session.workspaces.find((workspace) => workspace.id === editingWorkspaceId)}
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        onOpenContainerSettings={() => {
          setCreateOpen(false);
          setSettingsSectionRequest({ section: 'container', at: Date.now() });
          setPanel('settings');
        }}
      /> : null}
    </div>
  );
}

function CreateWorkspaceModal({
  session,
  workspace,
  isOpen,
  onOpenChange,
  onOpenContainerSettings,
}: {
  session: TodeXSession;
  workspace?: TodeXSession['workspaces'][number];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenContainerSettings: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(workspace?.name ?? '');
  // Container workspaces need Docker on this machine (desktop only) and are created, not edited.
  const containerAvailable = slots.containerWorkspaces && !workspace;
  const [mode, setMode] = useState<'local' | 'container'>('local');
  const containerFlow = slots.useContainerWorkspaceFlow({
    session,
    enabled: containerAvailable && mode === 'container',
    name,
    setName,
    deviceName: platform.productName,
    onDone: () => onOpenChange(false),
    onOpenSettings: onOpenContainerSettings,
  });
  const [path, setPath] = useState(workspace?.path ?? session.settings.defaultWorkspacePath);
  const [backendId, setBackendId] = useState(workspace?.backendConnectionId ?? session.activeBackendConnectionId);
  const [entries, setEntries] = useState<string[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [activeRoot, setActiveRoot] = useState('');
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  // The folder last picked on this machine and the backend path it became,
  // so the mount hint names the host folder rather than the mapped path.
  const [localPick, setLocalPick] = useState<{ host: string; backend: string } | null>(null);
  // Host folder a container backend cannot see ('' hides the hint).
  const [mountHint, setMountHint] = useState('');
  const settingsForBackend = (id: string) => {
    const profile = session.backendConnections.find((candidate) => candidate.id === id);
    return profile ? { ...session.settings, serverUrl: profile.serverUrl, deviceSecret: profile.deviceSecret, tenantId: profile.tenantId, encryptionProtocol: profile.encryptionProtocol, encryptionPublicKey: profile.encryptionPublicKey, transportVerified: profile.transportVerified } : session.settings;
  };
  const directorySettings = settingsForBackend(backendId);
  // Guards against a slow listing from a previously selected backend overwriting the current one.
  const browseRequest = useRef(0);

  const applySnapshot = (snapshot: Awaited<ReturnType<typeof fetchWorkspaceDirectorySnapshot>>) => {
    setMountHint('');
    setPath(snapshot.current);
    setEntries(snapshot.entries.map((entry) => entry.path));
    setRoots(snapshot.roots);
    setActiveRoot(snapshot.root);
  };

  const clearListing = () => {
    setEntries([]);
    setRoots([]);
    setActiveRoot('');
  };

  /** Shows `id`'s directories, starting at `preferredPath` or else that backend's configured workspace root. */
  const browseBackend = async (id: string, preferredPath?: string) => {
    const request = ++browseRequest.current;
    const settings = settingsForBackend(id);
    const backendRoot = session.backendLinkStatus[id]?.serverVersion?.workspace_root || '';
    // Without a path the backend lists its own workspace root.
    const attempts = [...new Set([preferredPath || undefined, backendRoot || undefined])];
    setPath(preferredPath || backendRoot);
    for (const attempt of attempts) {
      try {
        const snapshot = await fetchWorkspaceDirectorySnapshot(settings, attempt);
        if (request === browseRequest.current) applySnapshot(snapshot);
        return;
      } catch {
        // Fall through to the backend's root.
      }
    }
    if (request === browseRequest.current) clearListing();
  };

  useEffect(() => {
    if (!isOpen || workspace) return;
    setBackendId(session.activeBackendConnectionId);
    void browseBackend(session.activeBackendConnectionId, session.settings.defaultWorkspacePath);
  }, [isOpen, workspace, session.activeBackendConnectionId, session.settings]);

  const readFailed = (error: unknown) => toast.danger(error instanceof Error ? error.message : t('app.workspaceReadFailed'));
  const serverVersion = session.backendLinkStatus[workspace?.backendConnectionId ?? backendId]?.serverVersion;
  // A container backend that cannot see the folder gets the mount hint instead of the raw error.
  const pathFailed = (error: unknown) => {
    if (isUnmountedPathError(serverVersion?.deployment, error)) setMountHint(localPick?.backend === path ? localPick.host : path);
    else readFailed(error);
  };

  const submitNewFolder = async () => {
    const folderName = newFolderName?.trim();
    if (!folderName || creatingFolder) return;
    setCreatingFolder(true);
    try {
      applySnapshot(await createWorkspaceDirectory(directorySettings, path, folderName));
    } catch (error) {
      readFailed(error);
      return;
    } finally {
      setCreatingFolder(false);
    }
    if (!name.trim()) setName(folderName);
    setNewFolderName(null);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={workspace ? t('app.workspaceEditTitle') : t('app.workspaceCreateTitle')}
      size="lg"
      bodyClassName="flex flex-col gap-4"
      footer={mode === 'container' ? containerFlow.footer : (
        <>
          {workspace ? null : (
            <Button variant="secondary" className="me-auto" leadingIcon={RiFolderAddLine} onClick={() => setNewFolderName('')}>
              {t('app.workspaceNewFolder')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            leadingIcon={workspace ? undefined : RiAddLine}
            onClick={async () => {
              let validatedPath = path;
              // Every backend keeps its own connection: validate against the chosen one.
              if (session.backendLinkStatus[workspace?.backendConnectionId ?? backendId]?.state === 'open') {
                try {
                  validatedPath = (await fetchWorkspaceDirectorySnapshot(directorySettings, path)).current;
                } catch (error) {
                  pathFailed(error);
                  return;
                }
              }
              if (workspace) {
                session.updateWorkspace(workspace.id, { name: name.trim() || validatedPath, path: validatedPath });
              } else {
                session.createWorkspace(name.trim() || validatedPath, validatedPath, backendId);
              }
              onOpenChange(false);
            }}
          >
            {workspace ? t('common.save') : t('app.workspaceCreate')}
          </Button>
        </>
      )}
    >
      {containerAvailable ? (
        <SegmentedControl
          aria-label={t('app.workspaceKind')}
          className="self-start"
          selectedKeys={new Set([mode])}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next === 'local' || next === 'container') setMode(next);
          }}
        >
          <SegmentedControlItem id="local">{t('app.workspaceKindLocal')}</SegmentedControlItem>
          <SegmentedControlItem id="container">{t('app.workspaceKindContainer')}</SegmentedControlItem>
        </SegmentedControl>
      ) : null}
      <Field label={t('app.workspaceName')} value={name} onChange={setName} />
      {mode === 'container' ? containerFlow.body : <>
      <Select
        label={t('app.workspaceBackend')}
        className="w-full"
        popoverClassName="w-(--trigger-width)"
        isDisabled={Boolean(workspace)}
        selectedKey={backendId}
        onSelectionChange={(key) => {
          if (typeof key !== 'string' || key === backendId) return;
          setBackendId(key);
          void browseBackend(key);
        }}
      >
        {session.backendConnections.map((profile) => <SelectItem key={profile.id} id={profile.id} textValue={profile.name}>{profile.name} · {profile.serverUrl}</SelectItem>)}
      </Select>
      <Field label={t('app.workspaceDirectory')} value={path} onChange={(value) => { setPath(value); setMountHint(''); }} />
      {mountHint ? <WorkspaceMountHint path={mountHint} /> : null}
      {roots.length > 1 ? (
        <Select
          label={t('app.workspaceRoot')}
          className="w-full"
          popoverClassName="w-(--trigger-width)"
          selectedKey={activeRoot}
          onSelectionChange={(key) => {
            if (typeof key !== 'string' || key === activeRoot) return;
            void fetchWorkspaceDirectorySnapshot(directorySettings, key)
              .then(applySnapshot)
              .catch(readFailed);
          }}
        >
          {roots.map((root) => <SelectItem key={root} id={root} textValue={root}>{root}</SelectItem>)}
        </Select>
      ) : null}
      <div className="flex gap-2">
        {platform.files ? <Button
          variant="secondary"
          onClick={async () => {
            const selected = await platform.files?.pickDirectory();
            if (!selected) return;
            // A container backend sees host folders at its own paths.
            const picked = pickedHostPathToBackend({
              loopback: isLocalBackendUrl(directorySettings.serverUrl),
              deployment: serverVersion?.deployment ?? 'host',
              pathMappings: serverVersion?.pathMappings ?? [],
              windows: platform.os === 'win32',
            }, selected, mapHostPathToBackend);
            setPath(picked.path);
            setLocalPick({ host: selected, backend: picked.path });
            setMountHint(picked.unmounted ? selected : '');
          }}
        >
          {t('app.workspacePickLocal')}
        </Button> : null}
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              applySnapshot(await fetchWorkspaceDirectorySnapshot(directorySettings, path));
            } catch (error) {
              pathFailed(error);
            }
          }}
        >
          {t('app.workspaceBrowse')}
        </Button>
      </div>
      {entries.length ? (
        <ScrollArea className="max-h-40" contentClassName="flex flex-col gap-0.5" surface="full">
          {entries.map((entry) => (
            <button
              key={entry}
              type="button"
              className="flex w-full cursor-pointer items-center rounded-lg px-2 py-1.5 text-start text-body-regular text-text-secondary outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              onClick={() => setPath(entry)}
            >
              <span className="truncate">{entry}</span>
            </button>
          ))}
        </ScrollArea>
      ) : null}
      </>}
      <Modal
        isOpen={newFolderName !== null}
        onOpenChange={(open) => { if (!open) setNewFolderName(null); }}
        title={t('app.workspaceNewFolder')}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setNewFolderName(null)}>{t('common.cancel')}</Button>
            <Button type="submit" form="workspace-new-folder-form" disabled={creatingFolder || !newFolderName?.trim()}>{t('app.workspaceCreate')}</Button>
          </>
        )}
      >
        <form id="workspace-new-folder-form" onSubmit={(event) => { event.preventDefault(); void submitNewFolder(); }}>
          <Input label={t('app.workspaceNewFolderName')} hint={path} value={newFolderName ?? ''} onChange={setNewFolderName} autoFocus />
        </form>
      </Modal>
    </Modal>
  );
}

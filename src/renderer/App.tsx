import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RiAddLine, RiExpandLeftLine, RiExpandRightLine, RiGithubLine, RiLayoutLeftLine, RiLayoutRightLine, RiRobot2Line } from '@remixicon/react';
import { motion, useReducedMotion } from 'motion/react';
import { Dialog, Modal as AriaModal, ModalOverlay } from 'react-aria-components';
import { Badge } from '@/components/base/badges/badge';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { useDirection } from '@/components/foundations/direction/direction';
import { IconAction } from '@/components/ui/icon-action';
import { Modal } from '@/components/ui/modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToastViewport, toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { ConversationSplit, useMediaQuery } from './components/ConversationSplit';
import { useWorkbenchLayout } from './session/useWorkbenchLayout';
import { sshWorkbenchScopeKey, workbenchScopeKey } from './session/workbenchLayout';
import { createAgentBrowserWatch, takeNewAgentBrowserTab } from './session/agentBrowserTabs';
import { createSshExecWatch, takeNewSshExecs } from './session/sshExecTabs';
import { useTodeXSession, type TodeXSession } from './session/useTodeXSession';
import { ConversationHeaderDetails } from './components/ConversationHeaderDetails';
import { GitActionsModal } from './components/GitActionsModal';
import { DesktopAlertHost } from './components/DesktopAlertHost';
import { SessionNoticeToasts } from './components/SessionNoticeToasts';
import { useNoticeToast } from './components/NoticeToast';
import { AppSidebar } from './components/AppSidebar';
import { AppIcon } from './components/AppIcon';
import { ChatPanel } from './screens/ChatPanel';
import { HistoryRecoveryNotice } from './components/HistoryRecoveryNotice';
import { Field } from './components/Field';
import { connectionStateLabel, fetchWorkspaceDirectorySnapshot } from './session/helpers';
import { isWorkbenchTab, panelFromRoute, type DesktopPanel, type OpenPanelOptions, type WorkbenchItem, type WorkbenchRequest, type WorkbenchTab } from './lib/panels';
import type { RemoteFilesBinding } from './session/fileSources';
import { ShortcutHint, useAppShortcuts, useShortcutHintTracking } from './lib/shortcuts';
import { useT } from './i18n';
import { useAppearance } from './lib/appearance';
import { useFeatureModes } from './session/featureToggles';

// Secondary surfaces load on demand so the main bundle stays small.
const SettingsPanel = lazy(() => import('./screens/SettingsPanel').then((module) => ({ default: module.SettingsPanel })));
const AsidePanel = lazy(() => import('./screens/AsidePanel').then((module) => ({ default: module.AsidePanel })));
const CapabilitiesPanel = lazy(() => import('./screens/CapabilitiesPanel').then((module) => ({ default: module.CapabilitiesPanel })));
const WorkbenchPanel = lazy(() => import('./screens/WorkbenchPanel').then((module) => ({ default: module.WorkbenchPanel })));
const UsagePanel = lazy(() => import('./screens/UsagePanel').then((module) => ({ default: module.UsagePanel })));
const QuotaPanel = lazy(() => import('./screens/QuotaPanel').then((module) => ({ default: module.QuotaPanel })));
const AboutPanel = lazy(() => import('./screens/AboutPanel').then((module) => ({ default: module.AboutPanel })));
const CliManagerPanel = lazy(() => import('./screens/CliManagerPanel').then((module) => ({ default: module.CliManagerPanel })));
const AgentProvidersPanel = lazy(() => import('./screens/AgentProvidersPanel').then((module) => ({ default: module.AgentProvidersPanel })));
const CleanupPanel = lazy(() => import('./screens/CleanupPanel').then((module) => ({ default: module.CleanupPanel })));
const KanbanPanel = lazy(() => import('./screens/KanbanPanel').then((module) => ({ default: module.KanbanPanel })));
const SshPanel = lazy(() => import('./screens/SshPanel').then((module) => ({ default: module.SshPanel })));

function PanelFallback() {
  const t = useT();
  return <div className="flex h-full min-h-24 items-center justify-center text-body-regular text-text-secondary">{t('app.loading')}</div>;
}
const panelFallback = <PanelFallback />;

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
      className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 ease-out data-[entering]:opacity-0 data-[exiting]:opacity-0 motion-reduce:transition-none"
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

const LAYOUT_AUTO_SAVE_ID = 'todex-desktop-app-layout';
const LAYOUT_OPEN_STORAGE_KEY = 'todex.desktop.layoutOpen.v3';

type LayoutOpenState = {
  sidebarOpen: boolean;
  asideOpen: boolean;
};

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function readLayoutOpen(): LayoutOpenState {
  try {
    const raw = window.localStorage.getItem(LAYOUT_OPEN_STORAGE_KEY);
    if (!raw) return { sidebarOpen: true, asideOpen: false };
    const parsed = JSON.parse(raw) as Partial<LayoutOpenState>;
    return {
      sidebarOpen: parsed.sidebarOpen !== false,
      asideOpen: parsed.asideOpen === true,
    };
  } catch {
    return { sidebarOpen: true, asideOpen: false };
  }
}

function writeLayoutOpen(next: LayoutOpenState) {
  window.localStorage.setItem(LAYOUT_OPEN_STORAGE_KEY, JSON.stringify(next));
}

export function App() {
  const t = useT();
  const themeSource = useAppearance().theme;
  const [panel, setPanel] = useState<DesktopPanel | null>(null);
  const panelScopeRef = useRef('');
  const [slashCommand, setSlashCommand] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(() => readLayoutOpen().sidebarOpen);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
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
  // The SSH view swaps the main content but keeps sidebar and Workbench; its
  // Workbench tabs (SSH terminals, remote files) live in a per-backend scope.
  const sshActive = panel === 'ssh';
  // The task board, like the terminal, takes the conversation's place in the shell.
  const kanbanActive = panel === 'kanban';
  const features = useFeatureModes();
  const terminalEnabled = features.terminal !== 'off';
  const kanbanEnabled = features.kanban !== 'off';
  // Turning a feature off leaves its view, however it was opened.
  useEffect(() => {
    if ((panel === 'ssh' && !terminalEnabled) || (panel === 'kanban' && !kanbanEnabled)) setPanel(null);
  }, [panel, terminalEnabled, kanbanEnabled]);
  const scopeKey = !session.hydrated || !session.workbenchSharingHydrated ? ''
    : sshActive ? sshWorkbenchScopeKey(session.activeBackendConnectionId || session.settings.serverUrl)
      : workbenchScopeKey(
        session.workbenchSharing,
        session.activeWorkspace?.backendConnectionId || session.activeBackendConnectionId || session.settings.serverUrl,
        session.activeWorkspace?.id || '', session.activeConversation?.id || '',
      );
  const layout = useWorkbenchLayout(scopeKey);
  const { isOpen: asideOpen, setOpen: setAsideOpenRaw, tab: workbenchTab, setTab: setWorkbenchTab,
    target: panelTarget, setTarget: setPanelTarget } = layout;
  // The aside is actually on screen; live views stop streaming otherwise.
  const asideShown = Boolean(scopeKey) && layout.hydrated && asideOpen && !kanbanActive;
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
    if (next !== 'settings' && next !== 'usage' && next !== 'quota' && next !== 'about' && next !== 'cli-manager' && next !== 'agent-providers' && next !== 'cleanup') {
      persistAsideOpen(true);
    }
  }, [persistAsideOpen, scopeKey, setPanelTarget, setWorkbenchTab]);
  openPanelHandlerRef.current = openPanel;

  useEffect(() => {
    setPanel(current => current && ['settings', 'usage', 'quota', 'about', 'cli-manager', 'agent-providers', 'cleanup', 'kanban', 'ssh'].includes(current) ? current : null);
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
  // An agent `ssh_exec` call that starts in the viewed conversation opens the
  // side panel on the conversation's single read-only Agent SSH log tab,
  // re-creating it if it was closed. Calls already in the runtime when the
  // conversation became the viewed one (history, replay) are only recorded,
  // and the SSH view (another Workbench scope) records without opening.
  const sshExecWatchRef = useRef(createSshExecWatch());
  const viewedConversationId = session.activeConversation?.id ?? '';
  const viewedRuntime = viewedConversationId ? session.conversationRuntimeById[viewedConversationId] : undefined;
  const viewedRecovering = viewedConversationId ? session.recoveringConversations[viewedConversationId] === true : false;
  useEffect(() => {
    const fresh = takeNewSshExecs(sshExecWatchRef.current, viewedConversationId, viewedRuntime, viewedRecovering);
    if (!fresh.length || sshActive || !scopeKey) return;
    queueWorkbenchRequest(id => ({ id, kind: 'ssh-exec', conversationId: viewedConversationId }));
    persistAsideOpen(true);
  }, [persistAsideOpen, queueWorkbenchRequest, scopeKey, sshActive, viewedConversationId, viewedRecovering, viewedRuntime]);
  // A new agent-browser tab lifetime in the viewed conversation (its first
  // successful call, or one after the tab closed) opens the live view.
  // Lifetimes already present when the conversation became the viewed one
  // (history, replay), failed calls, and a panel the user closed during the
  // same lifetime do not.
  const agentBrowserWatchRef = useRef(createAgentBrowserWatch());
  useEffect(() => {
    const started = takeNewAgentBrowserTab(agentBrowserWatchRef.current, viewedConversationId, viewedRuntime, viewedRecovering);
    if (!started || sshActive || !scopeKey) return;
    queueWorkbenchRequest(id => ({ id, kind: 'agent-browser', conversationId: viewedConversationId }));
    persistAsideOpen(true);
  }, [persistAsideOpen, queueWorkbenchRequest, scopeKey, sshActive, viewedConversationId, viewedRecovering, viewedRuntime]);
  const changeWorkbenchTab = useCallback((next: WorkbenchTab) => {
    setWorkbenchTab(next);
    setPanelTarget({});
  }, [setWorkbenchTab, setPanelTarget]);

  // The main process forwards Cmd+W as 'app:close-request'; close the active
  // workbench tab when the aside is showing, otherwise fall back to closing
  // the window so the platform shortcut keeps working.
  const workbenchCloseRef = useRef<() => boolean>(() => false);
  const asideOpenRef = useRef(asideOpen);
  asideOpenRef.current = asideOpen;
  useEffect(() => window.todexDesktop.app.onCloseRequest(() => {
    if (asideOpenRef.current && workbenchCloseRef.current()) return;
    window.todexDesktop.app.closeWindow();
  }), []);

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
  });

  useEffect(() => window.todexDesktop.theme.onUpdated(applyTheme), []);

  // Hand the light/dark/system choice to the platform, then read the result
  // (`onUpdated` covers later system changes while following the system).
  useEffect(() => {
    window.todexDesktop.theme.setSource(themeSource);
    void window.todexDesktop.theme.shouldUseDark().then(applyTheme);
  }, [themeSource]);

  useEffect(() => {
    const conversation = session.activeConversation;
    const status = connectionStateLabel(session.connectionState);
    document.title = conversation ? `TodeX · ${conversation.title} · ${status}` : `TodeX · ${status}`;
  }, [session.activeConversation, session.connectionState]);

  const insetChrome = window.todexDesktop.app.windowChrome === 'hidden-inset';
  const settingsOpen = panel === 'settings';
  // The "no recovery key" notice opened settings to set one up.
  const [historyRecoverySetup, setHistoryRecoverySetup] = useState(false);
  useEffect(() => { if (!settingsOpen) setHistoryRecoverySetup(false); }, [settingsOpen]);
  // A refused connection's re-pair action opened settings to pair again.
  const [repairPairing, setRepairPairing] = useState(false);
  useEffect(() => { if (!settingsOpen) setRepairPairing(false); }, [settingsOpen]);
  const usageOpen = panel === 'usage';
  const quotaOpen = panel === 'quota';
  const aboutOpen = panel === 'about';
  const cliManagerOpen = panel === 'cli-manager';
  const agentProvidersOpen = panel === 'agent-providers';
  const cleanupOpen = panel === 'cleanup';
  const modalPanel = settingsOpen || usageOpen || quotaOpen || aboutOpen || cliManagerOpen || agentProvidersOpen || cleanupOpen;
  const subagentRuns = session.activeConversation
    ? session.subagentsByConversation[session.activeConversation.id] ?? []
    : [];
  const activeSubagents = subagentRuns.filter(
    (run) => run.status === 'running' || run.status === 'queued',
  ).length;
  const overlayPanel = panelScopeRef.current === scopeKey && panel && panel !== 'kanban' && panel !== 'ssh' && !modalPanel && !isWorkbenchTab(panel) ? panel : null;

  const asideContent = (
    !scopeKey || !layout.hydrated ? null : (
      <Suspense fallback={panelFallback}>
        {overlayPanel ? (
          <AsidePanel
            session={session}
            panel={overlayPanel}
            slashCommand={slashCommand}
            onBack={() => setPanel(workbenchTab)}
          />
        ) : (
          <WorkbenchPanel key={scopeKey} scopeKey={scopeKey} shown={asideShown} session={session} tab={workbenchTab} target={panelTarget} onTabChange={changeWorkbenchTab} onTargetConsumed={consumePanelTarget} closeRequestRef={workbenchCloseRef}
            sshMode={sshActive} requests={workbenchRequests} onRequestsHandled={workbenchRequestsHandled} onItemsChange={sshActive ? setWorkbenchItems : undefined} />
        )}
      </Suspense>
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
      {sshActive || kanbanActive ? (
        <span className="min-w-0 flex-1 truncate text-body-semibold text-text-primary">{t(kanbanActive ? 'sidebar.kanban' : 'ssh.title')}</span>
      ) : (
        <ConversationHeaderDetails session={session} title={session.activeConversation?.title ?? t('app.conversation')} gitOpen={gitOpen} onOpenGit={() => setGitOpen(true)} />
      )}
      <div className="flex shrink-0 items-center gap-1">
        {!sshActive && !kanbanActive ? (
          <span className="relative inline-flex shrink-0">
            <IconAction icon={RiGithubLine} aria-label={t('app.githubActions')} onClick={() => setGitOpen(true)} />
            <ShortcutHint id="gitActions" className={headerHint} />
          </span>
        ) : null}
        {subagentRuns.length > 0 && !kanbanActive ? (
          <span className="relative inline-flex shrink-0">
            <IconAction
              icon={RiRobot2Line}
              aria-label={t('app.subagents')}
              active={panel === 'subagents' && asideOpen}
              aria-pressed={undefined}
              aria-expanded={asideOpen && panel === 'subagents'}
              onClick={() => openPanel('Subagents')}
            />
            {activeSubagents > 0 ? (
              <Badge color="primary" className="pointer-events-none absolute -end-1 -top-1 min-w-4 rounded-full px-0.5 text-caption-2-semibold">{activeSubagents}</Badge>
            ) : null}
          </span>
        ) : null}
        {asideShown && !compactLayout ? (
          <IconAction icon={RiExpandLeftLine} aria-label={t('app.collapseChat')} tooltip onClick={() => toggleChatCollapsed(true)} />
        ) : null}
        {kanbanActive ? null : <span className="relative inline-flex shrink-0">
          <IconAction icon={RiLayoutRightLine} aria-label={asideOpen ? t('app.closeAside') : t('app.openAside')} aria-expanded={asideOpen} onClick={() => persistAsideOpen(!asideOpen)} />
          <ShortcutHint id="toggleAside" className={headerHint} />
        </span>}
      </div>
    </header>
  );
  const mainContent = (
    kanbanActive ? (
      <Suspense fallback={panelFallback}>
        <KanbanPanel session={session} onOpenConversation={() => setPanel(null)} />
      </Suspense>
    ) : sshActive ? (
      <Suspense fallback={panelFallback}>
        <SshPanel
          session={session}
          scopeKey={scopeKey}
          workbenchItems={workbenchItems}
          onOpenSshTerminal={openSshTerminal}
          onOpenRemoteFiles={openRemoteFiles}
          onCloseWorkbenchItem={closeWorkbenchItem}
        />
      </Suspense>
    ) : session.historyEncryption.recoveryNoticeVisible ? (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
        <div className="shrink-0 px-5 pt-3">
          <HistoryRecoveryNotice
            className="mx-auto max-w-2xl"
            onSetup={() => { setHistoryRecoverySetup(true); setPanel('settings'); }}
            onDismiss={session.historyEncryption.dismissRecoveryNotice}
          />
        </div>
        <div className="min-h-0 flex-1"><ChatPanel session={session} /></div>
      </div>
    ) : <ChatPanel session={session} />
  );

  // The conversation container of the BoardUI AI chat shell: header row, then
  // the chat.
  const chatContainer = (
    <main className={cx(
      'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl',
      // The board's columns are secondary panels, so it sits on the full surface.
      kanbanActive ? 'border border-border-button-default bg-background-full' : 'bg-background-secondary-default',
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
      onCreateConversation={() => {
        if (!session.activeWorkspaceId) {
          return;
        }
        session.createConversation(session.activeWorkspaceId);
        setPanel(null);
      }}
      onCreateScheduledConversation={async (workspaceId, at) => {
        const record = await session.createScheduledConversation(workspaceId, at);
        if (record) setPanel(null);
        return Boolean(record);
      }}
      onOpenSettings={() => setPanel('settings')}
      onOpenCapabilities={() => setCapabilitiesOpen(true)}
      onOpenCliManager={() => { persistAsideOpen(false); setPanel('cli-manager'); }}
      onOpenAgentProviders={() => { persistAsideOpen(false); setPanel('agent-providers'); }}
      onOpenCleanup={() => { persistAsideOpen(false); setPanel('cleanup'); }}
      onOpenUsage={() => setPanel('usage')}
      onOpenQuota={() => setPanel('quota')}
      onOpenAbout={() => setPanel('about')}
      onOpenKanban={() => { setPanel('kanban'); persistAsideOpen(false); }}
      onOpenTerminal={toggleSshView}
      terminalActive={sshActive}
      kanbanActive={kanbanActive}
      onSelectConversation={() => setPanel(current => current === 'ssh' || current === 'kanban' ? null : current)}
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
        <Suspense fallback={panelFallback}><SettingsPanel session={session} historyRecoverySetup={historyRecoverySetup} repairPairing={repairPairing} /></Suspense>
      </Modal>
      <Modal isOpen={usageOpen} onOpenChange={closePanel('usage')} title={t('app.usage')} size="3xl" className="max-h-[92vh]" bodyClassName="overflow-y-auto">
        <Suspense fallback={panelFallback}><UsagePanel session={session} /></Suspense>
      </Modal>
      <Modal isOpen={quotaOpen} onOpenChange={closePanel('quota')} title={t('usage.quotaTitle')} size="2xl" className="max-h-[90vh]" bodyClassName="overflow-y-auto">
        <Suspense fallback={panelFallback}><QuotaPanel session={session} /></Suspense>
      </Modal>
      <Modal isOpen={aboutOpen} onOpenChange={closePanel('about')} title={t('app.about')} size="2xl" className="max-h-[90vh]" bodyClassName="overflow-y-auto">
        <Suspense fallback={panelFallback}><AboutPanel session={session} /></Suspense>
      </Modal>
      <Modal isOpen={cliManagerOpen} onOpenChange={closePanel('cli-manager')} title={t('app.cliManager')} size="3xl" className="max-h-[92vh]" bodyClassName="overflow-y-auto">
        <Suspense fallback={panelFallback}><CliManagerPanel session={session} /></Suspense>
      </Modal>
      <Modal isOpen={agentProvidersOpen} onOpenChange={closePanel('agent-providers')} title={t('app.agentProviders')} size="3xl" className="max-h-[92vh]" bodyClassName="overflow-y-auto">
        <Suspense fallback={panelFallback}><AgentProvidersPanel session={session} /></Suspense>
      </Modal>
      <Modal isOpen={cleanupOpen} onOpenChange={closePanel('cleanup')} title={t('app.cleanup')} size="3xl" className="max-h-[92vh]" bodyClassName="overflow-y-auto">
        <Suspense fallback={panelFallback}><CleanupPanel session={session} /></Suspense>
      </Modal>
      <Modal isOpen={capabilitiesOpen} onOpenChange={setCapabilitiesOpen} title={t('app.mcpSkillManager')} size="2xl" className="max-h-[90vh]" bodyClassName="overflow-y-auto">
        <Suspense fallback={panelFallback}><CapabilitiesPanel inDialog workspacePath={session.activeWorkspace?.path ?? session.settings.defaultWorkspacePath} providers={session.v2Providers} catalogs={session.capabilityCatalogs} onRefresh={(provider) => void session.refreshCapabilityCatalog(provider)} conversationId={session.activeConversation?.id} selectedSkills={session.activeConversation ? session.selectedSkills[session.activeConversation.id] ?? [] : []} canInvoke={Boolean(session.activeConversation?.v2ConversationId)} onToggleSkill={(skill, provider) => session.activeConversation && session.toggleCatalogSkill(session.activeConversation.id, skill, provider)} onPreviewSkill={(skill, provider) => session.previewSkillResource(provider, skill.resourceId)} onLoadMcpConfig={(server) => session.getMcpServerConfig(server.provider, server.resourceId)} manager={session.capabilityManager} /></Suspense>
      </Modal>
      <GitActionsModal key={session.activeConversation?.id} session={session} isOpen={gitOpen} onOpenChange={setGitOpen} />
      {createOpen ? <CreateWorkspaceModal
        key={editingWorkspaceId ?? 'create'}
        session={session}
        workspace={session.workspaces.find((workspace) => workspace.id === editingWorkspaceId)}
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
      /> : null}
    </div>
  );
}

function CreateWorkspaceModal({
  session,
  workspace,
  isOpen,
  onOpenChange,
}: {
  session: TodeXSession;
  workspace?: TodeXSession['workspaces'][number];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [name, setName] = useState(workspace?.name ?? '');
  const [path, setPath] = useState(workspace?.path ?? session.settings.defaultWorkspacePath);
  const [backendId, setBackendId] = useState(workspace?.backendConnectionId ?? session.activeBackendConnectionId);
  const [entries, setEntries] = useState<string[]>([]);
  const [roots, setRoots] = useState<string[]>([]);
  const [activeRoot, setActiveRoot] = useState('');
  const selectedBackend = session.backendConnections.find((profile) => profile.id === backendId);
  const directorySettings = selectedBackend ? { ...session.settings, serverUrl: selectedBackend.serverUrl, deviceSecret: selectedBackend.deviceSecret, tenantId: selectedBackend.tenantId, encryptionProtocol: selectedBackend.encryptionProtocol, encryptionPublicKey: selectedBackend.encryptionPublicKey, transportVerified: selectedBackend.transportVerified } : session.settings;

  const applySnapshot = (snapshot: Awaited<ReturnType<typeof fetchWorkspaceDirectorySnapshot>>) => {
    setPath(snapshot.current);
    setEntries(snapshot.entries.map((entry) => entry.path));
    setRoots(snapshot.roots);
    setActiveRoot(snapshot.root);
  };

  useEffect(() => {
    if (!isOpen || workspace) return;
    const defaultPath = session.settings.defaultWorkspacePath;
    setBackendId(session.activeBackendConnectionId);
    const backendRoot = session.serverVersion?.workspace_root || '';
    setPath(defaultPath);
    void fetchWorkspaceDirectorySnapshot(directorySettings, defaultPath)
      .then(applySnapshot)
      .catch(async () => {
        if (!backendRoot || backendRoot === defaultPath) {
          setEntries([]);
          setRoots([]);
          setActiveRoot('');
          return;
        }
        try {
          applySnapshot(await fetchWorkspaceDirectorySnapshot(directorySettings, backendRoot));
        } catch {
          setEntries([]);
          setRoots([]);
          setActiveRoot('');
        }
      });
  }, [isOpen, workspace, session.activeBackendConnectionId, session.serverVersion?.workspace_root, session.settings]);

  const readFailed = (error: unknown) => toast.danger(error instanceof Error ? error.message : t('app.workspaceReadFailed'));

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={workspace ? t('app.workspaceEditTitle') : t('app.workspaceCreateTitle')}
      size="lg"
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            leadingIcon={workspace ? undefined : RiAddLine}
            onClick={async () => {
              let validatedPath = path;
              if (session.connectionState === 'open') {
                try {
                  validatedPath = (await fetchWorkspaceDirectorySnapshot(directorySettings, path)).current;
                } catch (error) {
                  readFailed(error);
                  return;
                }
              }
              if (workspace) {
                session.updateWorkspace(workspace.id, { name: name.trim() || validatedPath, path: validatedPath });
              } else {
                session.setActiveBackendConnectionId(backendId);
                session.createWorkspace(name.trim() || validatedPath, validatedPath);
              }
              onOpenChange(false);
            }}
          >
            {workspace ? t('common.save') : t('app.workspaceCreate')}
          </Button>
        </>
      )}
    >
      <Field label={t('app.workspaceName')} value={name} onChange={setName} />
      <Select
        label={t('app.workspaceBackend')}
        className="w-full"
        popoverClassName="w-(--trigger-width)"
        isDisabled={Boolean(workspace)}
        selectedKey={backendId}
        onSelectionChange={(key) => { if (typeof key === 'string') setBackendId(key); }}
      >
        {session.backendConnections.map((profile) => <SelectItem key={profile.id} id={profile.id} textValue={profile.name}>{profile.name} · {profile.serverUrl}</SelectItem>)}
      </Select>
      <Field label={t('app.workspaceDirectory')} value={path} onChange={setPath} />
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
        <Button
          variant="secondary"
          onClick={async () => {
            const selected = await window.todexDesktop.dialog.openDirectory();
            if (selected) setPath(selected);
          }}
        >
          {t('app.workspacePickLocal')}
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              applySnapshot(await fetchWorkspaceDirectorySnapshot(directorySettings, path));
            } catch (error) {
              readFailed(error);
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
    </Modal>
  );
}

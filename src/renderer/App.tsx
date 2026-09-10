import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Label, ListBox, Modal, Select, Toast, toast } from '@heroui/react';
import { AppLayout, Navbar } from '@heroui-pro/react';
import { RiAddLine, RiGithubLine, RiLayoutLeftLine, RiLayoutRightLine } from '@remixicon/react';
import { useWorkbenchLayout } from './session/useWorkbenchLayout';
import { workbenchScopeKey } from './session/workbenchLayout';
import { useTodeXSession, type TodeXSession } from './session/useTodeXSession';
import { ConversationHeaderDetails } from './components/ConversationHeaderDetails';
import { GitActionsModal } from './components/GitActionsModal';
import { DesktopAlertHost } from './components/DesktopAlertHost';
import { AppSidebar } from './components/AppSidebar';
import { AppIcon } from './components/AppIcon';
import { ChatPanel } from './screens/ChatPanel';
import { SettingsPanel } from './screens/SettingsPanel';
import { AsidePanel } from './screens/AsidePanel';
import { CapabilitiesPanel } from './screens/CapabilitiesPanel';
import { WorkbenchPanel } from './screens/WorkbenchPanel';
import { UsagePanel } from './screens/UsagePanel';
import { AboutPanel } from './screens/AboutPanel';
import { CliManagerPanel } from './screens/CliManagerPanel';
import { KanbanPanel } from './screens/KanbanPanel';
import { Field } from './components/Field';
import { connectionStateLabel, fetchWorkspaceDirectorySnapshot } from './session/helpers';
import { isWorkbenchTab, panelFromRoute, type DesktopPanel, type OpenPanelOptions, type WorkbenchTab } from './lib/panels';

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
  const [panel, setPanel] = useState<DesktopPanel | null>(null);
  const panelScopeRef = useRef('');
  const [slashCommand, setSlashCommand] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(() => readLayoutOpen().sidebarOpen);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);

  const persistSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpen(open);
    writeLayoutOpen({ ...readLayoutOpen(), sidebarOpen: open });
  }, []);

  const openPanelHandlerRef = useRef<(name: string, params?: OpenPanelOptions) => void>(() => {});
  const forwardOpenPanel = useCallback((name: string, params?: OpenPanelOptions) => openPanelHandlerRef.current(name, params), []);
  const session = useTodeXSession(forwardOpenPanel);
  const scopeKey = session.hydrated && session.workbenchSharingHydrated ? workbenchScopeKey(
    session.workbenchSharing,
    session.activeWorkspace?.backendConnectionId || session.activeBackendConnectionId || session.settings.serverUrl,
    session.activeWorkspace?.id || '', session.activeConversation?.id || '',
  ) : '';
  const layout = useWorkbenchLayout(scopeKey);
  const { isOpen: asideOpen, setOpen: persistAsideOpen, tab: workbenchTab, setTab: setWorkbenchTab,
    target: panelTarget, setTarget: setPanelTarget } = layout;

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
    if (next !== 'settings' && next !== 'usage' && next !== 'about' && next !== 'cli-manager') {
      persistAsideOpen(true);
    }
  }, [persistAsideOpen, scopeKey, setPanelTarget, setWorkbenchTab]);
  openPanelHandlerRef.current = openPanel;

  useEffect(() => {
    setPanel(current => current && ['settings', 'usage', 'about', 'cli-manager', 'kanban'].includes(current) ? current : null);
    setSlashCommand(undefined);
  }, [scopeKey]);

  const consumePanelTarget = useCallback(() => setPanelTarget({}), [setPanelTarget]);
  const changeWorkbenchTab = useCallback((next: WorkbenchTab) => {
    setWorkbenchTab(next);
    setPanelTarget({});
  }, [setWorkbenchTab, setPanelTarget]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void window.todexDesktop.theme.shouldUseDark().then((dark) => {
      applyTheme(dark);
    });
    unsubscribe = window.todexDesktop.theme.onUpdated(applyTheme);
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const conversation = session.activeConversation;
    const status = connectionStateLabel(session.connectionState);
    document.title = conversation ? `TodeX · ${conversation.title} · ${status}` : `TodeX · ${status}`;
  }, [session.activeConversation, session.connectionState]);

  const settingsOpen = panel === 'settings';
  const usageOpen = panel === 'usage';
  const aboutOpen = panel === 'about';
  const cliManagerOpen = panel === 'cli-manager';
  const modalPanel = settingsOpen || usageOpen || aboutOpen || cliManagerOpen;
  const overlayPanel = panelScopeRef.current === scopeKey && panel && panel !== 'kanban' && !modalPanel && !isWorkbenchTab(panel) ? panel : null;

  return (
    <div className="bg-background text-foreground h-full">
      <Toast.Provider placement="top" />
      <DesktopAlertHost />
      {session.hydrated ? (
        <AppLayout
          className="h-full min-h-0"
          scrollMode="content"
          sidebarCollapsible="offcanvas"
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={persistSidebarOpen}
          sidebarResizable
          sidebarDefaultSize="248px"
          sidebarMinSize="200px"
          sidebarMaxSize="320px"
          sidebarResizeBehavior="preserve-pixel-size"
          asideMobile="sheet"
          asideResizable
          asideDefaultSize="420px"
          asideMinSize="320px"
          asideMaxSize="640px"
          asideResizeBehavior="preserve-pixel-size"
          resizableAutoSaveId={LAYOUT_AUTO_SAVE_ID}
          asideOpen={Boolean(scopeKey) && layout.hydrated && asideOpen}
          onAsideOpenChange={persistAsideOpen}
          aside={
            !scopeKey || !layout.hydrated ? null : overlayPanel ? (
              <AsidePanel
                session={session}
                panel={overlayPanel}
                slashCommand={slashCommand}
                onBack={() => setPanel(workbenchTab)}
              />
            ) : (
              <WorkbenchPanel key={scopeKey} scopeKey={scopeKey} session={session} tab={workbenchTab} target={panelTarget} onTabChange={changeWorkbenchTab} onTargetConsumed={consumePanelTarget} />
            )
          }
          sidebar={
            <AppSidebar
              session={session}
              onCreateWorkspace={() => { setEditingWorkspaceId(null); setCreateOpen(true); }}
              onEditWorkspace={(workspaceId) => { setEditingWorkspaceId(workspaceId); setCreateOpen(true); }}
              onCreateConversation={() => {
                if (!session.activeWorkspaceId) {
                  return;
                }
                session.createConversation(session.activeWorkspaceId);
                setPanel(null);
              }}
              onOpenSettings={() => setPanel('settings')}
              onOpenCapabilities={() => setCapabilitiesOpen(true)}
              onOpenCliManager={() => { persistAsideOpen(false); setPanel('cli-manager'); }}
              onOpenUsage={() => setPanel('usage')}
              onOpenAbout={() => setPanel('about')}
              onOpenKanban={() => { setPanel('kanban'); persistAsideOpen(false); }}
            />
          }
          navbar={
            <Navbar maxWidth="full">
              <Navbar.Header className="flex-nowrap gap-2 px-3 sm:px-6 [&>button]:shrink-0">
                <AppLayout.MenuToggle className="inline-flex min-[769px]:hidden" aria-label="打开导航侧栏"><RiLayoutLeftLine className="size-4" /></AppLayout.MenuToggle>
                <Button className="hidden min-[769px]:inline-flex" isIconOnly size="sm" variant="ghost" aria-label={sidebarOpen ? '折叠侧栏' : '展开侧栏'} onPress={() => persistSidebarOpen(!sidebarOpen)}>
                  <RiLayoutLeftLine className="size-4" />
                </Button>
                <ConversationHeaderDetails session={session} title={panel === 'kanban' ? '今日看板' : session.activeConversation?.title ?? '对话'} gitOpen={gitOpen} onOpenGit={() => setGitOpen(true)} />
                <Navbar.Content className="shrink-0 gap-2">
                  <Button isIconOnly size="sm" variant="ghost" aria-label="GitHub 操作" onPress={() => setGitOpen(true)}>
                    <RiGithubLine className="size-4" />
                  </Button>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={asideOpen ? '关闭右侧面板' : '打开右侧面板'} aria-expanded={asideOpen} onPress={() => persistAsideOpen(!asideOpen)}>
                    <RiLayoutRightLine className="size-4" />
                  </Button>
                </Navbar.Content>
              </Navbar.Header>
            </Navbar>
          }
        >
          {panel === 'kanban' ? (
            <KanbanPanel session={session} onOpenConversation={() => setPanel(null)} />
          ) : <ChatPanel session={session} />}
        </AppLayout>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <AppIcon className="size-16" />
          <p className="text-lg font-semibold">TodeX</p>
          <p className="text-muted text-sm">正在加载设置和工作区...</p>
        </div>
      )}
      <Modal isOpen={settingsOpen} onOpenChange={(open) => { if (!open) setPanel((current) => current === 'settings' ? null : current); }}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="max-h-[90vh] sm:max-w-xl">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>设置</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="max-h-[70vh] overflow-y-auto">
                <SettingsPanel session={session} />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal isOpen={usageOpen} onOpenChange={(open) => { if (!open) setPanel((current) => current === 'usage' ? null : current); }}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="max-h-[92vh] sm:max-w-5xl">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>使用统计</Modal.Heading></Modal.Header>
              <Modal.Body className="max-h-[82vh] overflow-y-auto p-0"><UsagePanel session={session} /></Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal isOpen={aboutOpen} onOpenChange={(open) => { if (!open) setPanel((current) => current === 'about' ? null : current); }}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="max-h-[90vh] sm:max-w-2xl">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>关于</Modal.Heading></Modal.Header>
              <Modal.Body className="max-h-[76vh] overflow-y-auto p-0"><AboutPanel session={session} /></Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal isOpen={cliManagerOpen} onOpenChange={(open) => { if (!open) setPanel((current) => current === 'cli-manager' ? null : current); }}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="max-h-[92vh] sm:max-w-3xl">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>CLI 管理</Modal.Heading></Modal.Header>
              <Modal.Body className="max-h-[80vh] overflow-y-auto p-0"><CliManagerPanel session={session} /></Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal isOpen={capabilitiesOpen} onOpenChange={setCapabilitiesOpen}>
        <Modal.Backdrop><Modal.Container><Modal.Dialog className="max-h-[90vh] sm:max-w-2xl"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>MCP / Skill 管理</Modal.Heading></Modal.Header><Modal.Body className="max-h-[75vh] overflow-y-auto"><CapabilitiesPanel workspacePath={session.activeWorkspace?.path ?? session.settings.defaultWorkspacePath} providers={session.v2Providers} catalogs={session.capabilityCatalogs} onRefresh={(provider) => void session.refreshCapabilityCatalog(provider)} conversationId={session.activeConversation?.id} selectedSkills={session.activeConversation ? session.selectedSkills[session.activeConversation.id] ?? [] : []} canInvoke={Boolean(session.activeConversation?.v2ConversationId)} onToggleSkill={(skill, provider) => session.activeConversation && session.toggleCatalogSkill(session.activeConversation.id, skill, provider)} onPreviewSkill={(skill, provider) => session.previewSkillResource(provider, skill.resourceId)} onRefreshMcp={(resourceId) => session.activeConversation && session.refreshMcpServer(session.activeConversation.id, resourceId)} onCallMcp={(resourceId, toolName) => session.activeConversation && session.callMcpTool(session.activeConversation.id, resourceId, toolName)} /></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>
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
  const [name, setName] = useState(workspace?.name ?? '');
  const [path, setPath] = useState(workspace?.path ?? session.settings.defaultWorkspacePath);
  const [backendId, setBackendId] = useState(workspace?.backendConnectionId ?? session.activeBackendConnectionId);
  const [entries, setEntries] = useState<string[]>([]);
  const selectedBackend = session.backendConnections.find((profile) => profile.id === backendId);
  const directorySettings = selectedBackend ? { ...session.settings, serverUrl: selectedBackend.serverUrl, authToken: selectedBackend.authToken, tenantId: selectedBackend.tenantId, encryptionProtocol: selectedBackend.encryptionProtocol, encryptionPublicKey: selectedBackend.encryptionPublicKey } : session.settings;

  useEffect(() => {
    if (!isOpen || workspace) return;
    const defaultPath = session.settings.defaultWorkspacePath;
    setBackendId(session.activeBackendConnectionId);
    const backendRoot = session.serverVersion?.workspace_root || '';
    setPath(defaultPath);
    void fetchWorkspaceDirectorySnapshot(directorySettings, defaultPath)
      .then((snapshot) => {
        setPath(snapshot.current);
        setEntries(snapshot.entries.map((entry) => entry.path));
      })
      .catch(async () => {
        if (!backendRoot || backendRoot === defaultPath) {
          setEntries([]);
          return;
        }
        try {
          const snapshot = await fetchWorkspaceDirectorySnapshot(directorySettings, backendRoot);
          setPath(snapshot.current);
          setEntries(snapshot.entries.map((entry) => entry.path));
        } catch {
          setEntries([]);
        }
      });
  }, [isOpen, workspace, session.activeBackendConnectionId, session.serverVersion?.workspace_root, session.settings]);

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{workspace ? '编辑工作区' : '新建工作区'}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <Field label="名称" value={name} onChange={setName} />
              <Select isDisabled={Boolean(workspace)} selectedKey={backendId} onSelectionChange={(key) => { if (typeof key === 'string') setBackendId(key); }}>
                <Label>连接后端</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>{session.backendConnections.map((profile) => <ListBox.Item key={profile.id} id={profile.id} textValue={profile.name}>{profile.name} · {profile.serverUrl}</ListBox.Item>)}</ListBox></Select.Popover>
              </Select>
              <Field label="目录" value={path} onChange={setPath} />
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onPress={async () => {
                    const selected = await window.todexDesktop.dialog.openDirectory();
                    if (selected) setPath(selected);
                  }}
                >
                  本机选择
                </Button>
                <Button
                  variant="tertiary"
                  onPress={async () => {
                    try {
                      const snapshot = await fetchWorkspaceDirectorySnapshot(directorySettings, path);
                      setPath(snapshot.current);
                      setEntries(snapshot.entries.map((entry) => entry.path));
                    } catch (error) {
                      toast.danger(error instanceof Error ? error.message : '无法读取目录');
                    }
                  }}
                >
                  浏览后端目录
                </Button>
              </div>
              {entries.length ? (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {entries.map((entry) => (
                    <Button key={entry} variant="ghost" className="justify-start" onPress={() => setPath(entry)}>
                      {entry}
                    </Button>
                  ))}
                </div>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">取消</Button>
              <Button
                onPress={async () => {
                  let validatedPath = path;
                  if (session.connectionState === 'open') {
                    try {
                      validatedPath = (await fetchWorkspaceDirectorySnapshot(directorySettings, path)).current;
                    } catch (error) {
                      toast.danger(error instanceof Error ? error.message : '无法读取目录');
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
                {workspace ? null : <RiAddLine className="size-4" />}
                {workspace ? '保存' : '创建'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

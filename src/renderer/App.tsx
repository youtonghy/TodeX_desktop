import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Label, ListBox, Modal, Select, Toast, toast, Checkbox, TextArea, TextField } from '@heroui/react';
import { AppLayout, Navbar } from '@heroui-pro/react';
import { RiAddLine, RiGitBranchLine, RiGitCommitLine, RiGithubLine, RiLayoutLeftLine, RiUploadCloud2Line } from '@remixicon/react';
import type { GitRepositorySummary } from '../preload';
import { useTodeXSession, type TodeXSession } from './session/useTodeXSession';
import { DesktopAlertHost } from './components/DesktopAlertHost';
import { AppSidebar } from './components/AppSidebar';
import { ChatPanel } from './screens/ChatPanel';
import { SettingsPanel } from './screens/SettingsPanel';
import { ProviderIcon } from './components/ProviderIcon';
import { AsidePanel } from './screens/AsidePanel';
import { CapabilitiesPanel } from './screens/CapabilitiesPanel';
import { WorkbenchPanel } from './screens/WorkbenchPanel';
import { UsagePanel } from './screens/UsagePanel';
import { AboutPanel } from './screens/AboutPanel';
import { KanbanPanel } from './screens/KanbanPanel';
import { Field } from './components/Field';
import { connectionStateLabel, fetchWorkspaceDirectorySnapshot, isV2Conversation } from './session/helpers';
import { providerDisplayName } from '@todex/protocol/v2';
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
  const [panelTarget, setPanelTarget] = useState<OpenPanelOptions>({});
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('terminal');
  const [slashCommand, setSlashCommand] = useState<string>();
  const [asideOpen, setAsideOpen] = useState(() => readLayoutOpen().asideOpen);
  const [sidebarOpen, setSidebarOpen] = useState(() => readLayoutOpen().sidebarOpen);
  const [createOpen, setCreateOpen] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);

  const persistSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpen(open);
    writeLayoutOpen({ ...readLayoutOpen(), sidebarOpen: open });
  }, []);

  const persistAsideOpen = useCallback((open: boolean) => {
    setAsideOpen(open);
    writeLayoutOpen({ ...readLayoutOpen(), asideOpen: open });
  }, []);

  const openPanel = useCallback((name: string, params?: OpenPanelOptions) => {
    const next = panelFromRoute(name);
    if (!next) {
      return;
    }
    setSlashCommand(params?.command);
    setPanelTarget({ url: params?.url, filePath: params?.filePath });
    setPanel(next);
    if (isWorkbenchTab(next)) {
      setWorkbenchTab(next);
    }
    if (next !== 'settings' && next !== 'usage' && next !== 'about') {
      persistAsideOpen(true);
    }
  }, [persistAsideOpen]);

  const session = useTodeXSession(openPanel);

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
  const modalPanel = settingsOpen || usageOpen || aboutOpen;
  const overlayPanel = panel && panel !== 'kanban' && !modalPanel && !isWorkbenchTab(panel) ? panel : null;

  return (
    <div className="bg-background text-foreground h-full">
      <Toast.Provider />
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
          asideResizable
          asideDefaultSize="420px"
          asideMinSize="320px"
          asideMaxSize="640px"
          asideResizeBehavior="preserve-pixel-size"
          resizableAutoSaveId={LAYOUT_AUTO_SAVE_ID}
          asideOpen={asideOpen}
          onAsideOpenChange={persistAsideOpen}
          aside={
            overlayPanel ? (
              <AsidePanel
                session={session}
                panel={overlayPanel}
                slashCommand={slashCommand}
                onBack={() => setPanel(workbenchTab)}
              />
            ) : (
              <WorkbenchPanel session={session} tab={workbenchTab} target={panelTarget} onTabChange={setWorkbenchTab} />
            )
          }
          sidebar={
            <AppSidebar
              session={session}
              onCreateWorkspace={() => setCreateOpen(true)}
              onCreateConversation={() => {
                if (!session.activeWorkspaceId) {
                  return;
                }
                session.createConversation(session.activeWorkspaceId);
                setPanel(null);
              }}
              onOpenSettings={() => setPanel('settings')}
              onOpenCapabilities={() => setCapabilitiesOpen(true)}
              onOpenUsage={() => setPanel('usage')}
              onOpenAbout={() => setPanel('about')}
              onOpenKanban={() => { setPanel('kanban'); persistAsideOpen(false); }}
            />
          }
          navbar={
            <Navbar maxWidth="full">
              <Navbar.Header>
                <Button isIconOnly size="sm" variant="ghost" aria-label={sidebarOpen ? '折叠侧栏' : '展开侧栏'} onPress={() => persistSidebarOpen(!sidebarOpen)}>
                  <RiLayoutLeftLine className="size-4" />
                </Button>
                <span className="truncate text-sm font-medium">
                  {panel === 'kanban' ? '今日看板' : session.activeConversation?.title ?? '对话'}
                </span>
                {session.activeConversation ? (
                  <Chip size="sm" variant="soft" className="whitespace-nowrap">
                    <ProviderIcon provider={isV2Conversation(session.activeConversation) ? session.activeConversation.provider : 'codex'} />
                    {isV2Conversation(session.activeConversation)
                      ? providerDisplayName(session.activeConversation.provider || '', 'Agent')
                      : '历史 Codex'}
                  </Chip>
                ) : null}
                <Navbar.Spacer />
                <Navbar.Content>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="GitHub 操作" onPress={() => setGitOpen(true)}>
                    <RiGithubLine className="size-4" />
                  </Button>
                  <AppLayout.AsideTrigger />
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
          <div className="bg-accent flex size-10 items-center justify-center rounded-lg">
            <span className="text-accent-foreground text-lg font-semibold">T</span>
          </div>
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
      <Modal isOpen={capabilitiesOpen} onOpenChange={setCapabilitiesOpen}>
        <Modal.Backdrop><Modal.Container><Modal.Dialog className="max-h-[90vh] sm:max-w-2xl"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>MCP / Skill 管理</Modal.Heading></Modal.Header><Modal.Body className="max-h-[75vh] overflow-y-auto"><CapabilitiesPanel workspacePath={session.activeWorkspace?.path ?? session.settings.defaultWorkspacePath} providers={session.v2Providers} catalogs={session.capabilityCatalogs} onRefresh={(provider) => void session.refreshCapabilityCatalog(provider)} conversationId={session.activeConversation?.id} selectedSkills={session.activeConversation ? session.selectedSkills[session.activeConversation.id] ?? [] : []} canInvoke={Boolean(session.activeConversation?.v2ConversationId)} onToggleSkill={(skill, provider) => session.activeConversation && session.toggleCatalogSkill(session.activeConversation.id, skill, provider)} onPreviewSkill={(skill, provider) => session.previewSkillResource(provider, skill.resourceId)} onRefreshMcp={(resourceId) => session.activeConversation && session.refreshMcpServer(session.activeConversation.id, resourceId)} onCallMcp={(resourceId, toolName) => session.activeConversation && session.callMcpTool(session.activeConversation.id, resourceId, toolName)} /></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>
      <GitHubModal session={session} isOpen={gitOpen} onOpenChange={setGitOpen} />
      <CreateWorkspaceModal session={session} isOpen={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function GitHubModal({ session, isOpen, onOpenChange }: { session: TodeXSession; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const [repos, setRepos] = useState<GitRepositorySummary[]>([]);
  const [activeRepoPath, setActiveRepoPath] = useState('');
  const [message, setMessage] = useState('');
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [loading, setLoading] = useState(false);
  const workspacePath = session.activeWorkspace?.path || session.settings.defaultWorkspacePath;
  const activeRepo = repos.find((repo) => repo.path === activeRepoPath) ?? repos[0];

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const next = await window.todexDesktop.git.scan(workspacePath);
      setRepos(next);
      setActiveRepoPath((current) => next.some((repo) => repo.path === current) ? current : next.find((repo) => repo.files.length > 0)?.path ?? next[0]?.path ?? '');
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : 'Git 状态读取失败');
    } finally { setLoading(false); }
  }, [workspacePath]);

  useEffect(() => { if (isOpen) void refresh(); }, [isOpen, refresh]);

  const run = async (action: 'commit' | 'commit-push' | 'push' | 'initial') => {
    if (!activeRepo) return;
    setLoading(true);
    try {
      await window.todexDesktop.git.run(activeRepo.path, action, message, includeUnstaged);
      toast.success(action === 'initial' ? '已初始化并创建提交' : action === 'push' ? '已推送' : action === 'commit-push' ? '已提交并推送' : '已创建提交');
      await refresh();
    } catch (error) { toast.danger(error instanceof Error ? error.message : 'Git 操作失败'); }
    finally { setLoading(false); }
  };

  return <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
    <Modal.Backdrop><Modal.Container><Modal.Dialog className="sm:max-w-md">
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Icon className="bg-default text-foreground"><RiGithubLine className="size-5" /></Modal.Icon>
        {repos.length > 1 ? <><Modal.Heading className="sr-only">GitHub 操作</Modal.Heading><Select className="w-full" aria-label="选择仓库" selectedKey={activeRepo?.path} onSelectionChange={(key) => { if (typeof key === 'string') setActiveRepoPath(key); }}>
          <Select.Trigger className="min-w-0"><RiGitBranchLine className="size-4" /><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover><ListBox>{repos.map((repo) => <ListBox.Item key={repo.path} id={repo.path} textValue={`${repo.name} ${repo.branch}`}>{repo.name} · {repo.branch}</ListBox.Item>)}</ListBox></Select.Popover>
        </Select></> : <Modal.Heading className="flex min-w-0 items-center gap-2"><RiGitBranchLine className="size-4" /><span className="truncate">{activeRepo?.branch || '未初始化'}</span></Modal.Heading>}
      </Modal.Header>
      <Modal.Body>
        <TextField value={message} onChange={setMessage} aria-label="提交信息">
          <TextArea className="min-h-28 resize-none" placeholder="提交信息（留空将自动生成）..." />
        </TextField>
        {activeRepo?.error ? <p className="text-danger text-xs">{activeRepo.error}</p> : null}
        <div className="border-separator flex items-center gap-3 border-b py-3">
          <Checkbox isSelected={includeUnstaged} onChange={setIncludeUnstaged} aria-label="包含未暂存的更改" />
          <span className="text-sm">包含未暂存的更改 <span className="text-muted">· {activeRepo?.files.length ?? 0} 个文件</span></span>
          <span className="ml-auto font-mono text-sm tabular-nums"><span className="text-success">+{activeRepo?.additions ?? 0}</span> <span className="text-danger">-{activeRepo?.deletions ?? 0}</span></span>
        </div>
        <div className="pt-2">
          <Button variant="secondary" className="h-12 w-full justify-start gap-3 text-base" onPress={() => void run(activeRepo?.initialEligible ? 'initial' : 'commit')} isDisabled={loading || !activeRepo}>
            <RiGitCommitLine className="size-5" /><span>{activeRepo?.initialEligible ? '初始化仓库' : '提交'}</span>
          </Button>
          <Button variant="ghost" className="h-12 w-full justify-start gap-3 text-base" onPress={() => void run('commit-push')} isDisabled={loading || !activeRepo || Boolean(activeRepo.initialEligible)}><RiUploadCloud2Line className="size-5" />提交并推送</Button>
          <Button variant="ghost" className="h-12 w-full justify-start gap-3 text-base" onPress={() => void run('push')} isDisabled={loading || !activeRepo || Boolean(activeRepo.initialEligible)}><RiUploadCloud2Line className="size-5" />推送</Button>
        </div>
      </Modal.Body>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
  </Modal>;
}

function CreateWorkspaceModal({
  session,
  isOpen,
  onOpenChange,
}: {
  session: TodeXSession;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState(session.settings.defaultWorkspacePath);
  const [backendId, setBackendId] = useState(session.activeBackendConnectionId);
  const [entries, setEntries] = useState<string[]>([]);
  const selectedBackend = session.backendConnections.find((profile) => profile.id === backendId);
  const directorySettings = selectedBackend ? { ...session.settings, serverUrl: selectedBackend.serverUrl, authToken: selectedBackend.authToken, tenantId: selectedBackend.tenantId, encryptionProtocol: selectedBackend.encryptionProtocol, encryptionPublicKey: selectedBackend.encryptionPublicKey } : session.settings;

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, session.activeBackendConnectionId, session.serverVersion?.workspace_root, session.settings]);

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>新建工作区</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <Field label="名称" value={name} onChange={setName} />
              <Select selectedKey={backendId} onSelectionChange={(key) => { if (typeof key === 'string') setBackendId(key); }}>
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
                  session.setActiveBackendConnectionId(backendId);
                  session.createWorkspace(name || validatedPath, validatedPath);
                  onOpenChange(false);
                }}
              >
                <RiAddLine className="size-4" />
                创建
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

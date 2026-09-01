import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Label, ListBox, Modal, Select, Toast, toast, Checkbox, Input, TextField } from '@heroui/react';
import { AppLayout, Navbar } from '@heroui-pro/react';
import { RiAddLine, RiGithubLine, RiLayoutLeftLine } from '@remixicon/react';
import type { GitRepositorySummary } from '../preload';
import { useTodeXSession, type TodeXSession } from './session/useTodeXSession';
import { DesktopAlertHost } from './components/DesktopAlertHost';
import { AppSidebar } from './components/AppSidebar';
import { ChatPanel } from './screens/ChatPanel';
import { SettingsPanel } from './screens/SettingsPanel';
import { AsidePanel } from './screens/AsidePanel';
import { CapabilitiesPanel } from './screens/CapabilitiesPanel';
import { WorkbenchPanel } from './screens/WorkbenchPanel';
import { UsagePanel } from './screens/UsagePanel';
import { AboutPanel } from './screens/AboutPanel';
import { Field } from './components/Field';
import { connectionStateLabel, fetchWorkspaceDirectorySnapshot, isV2Conversation } from './session/helpers';
import { providerDisplayName, type ProviderKind } from '@todex/protocol/v2';
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
  const [createConversationOpen, setCreateConversationOpen] = useState(false);
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
    if (name === 'CreateConversation') {
      setCreateConversationOpen(true);
      return;
    }
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
  const overlayPanel = panel && !modalPanel && !isWorkbenchTab(panel) ? panel : null;

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
                if (session.activeWorkspaceId) {
                  setCreateConversationOpen(true);
                }
              }}
              onOpenSettings={() => setPanel('settings')}
              onOpenCapabilities={() => setCapabilitiesOpen(true)}
              onOpenUsage={() => setPanel('usage')}
              onOpenAbout={() => setPanel('about')}
            />
          }
          navbar={
            <Navbar maxWidth="full">
              <Navbar.Header>
                <Button isIconOnly size="sm" variant="ghost" aria-label={sidebarOpen ? '折叠侧栏' : '展开侧栏'} onPress={() => persistSidebarOpen(!sidebarOpen)}>
                  <RiLayoutLeftLine className="size-4" />
                </Button>
                <span className="truncate text-sm font-medium">
                  {session.activeConversation?.title ?? '对话'}
                </span>
                {session.activeConversation ? (
                  <Chip size="sm" variant="soft" className="whitespace-nowrap">
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
          <ChatPanel session={session} />
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
        <Modal.Backdrop><Modal.Container><Modal.Dialog className="max-h-[90vh] sm:max-w-2xl"><Modal.CloseTrigger /><Modal.Header><Modal.Heading>MCP / Skill 管理</Modal.Heading></Modal.Header><Modal.Body className="max-h-[75vh] overflow-y-auto"><CapabilitiesPanel workspacePath={session.activeWorkspace?.path ?? session.settings.defaultWorkspacePath} providers={session.v2Providers} catalogs={session.capabilityCatalogs} onRefresh={(provider) => void session.refreshCapabilityCatalog(provider)} conversationId={session.activeConversation?.id} selectedSkills={session.activeConversation ? session.selectedSkills[session.activeConversation.id] ?? [] : []} canInvoke={Boolean(session.activeConversation?.v2ConversationId || session.activeConversation?.provider)} onToggleSkill={(skill, provider) => session.activeConversation && session.toggleCatalogSkill(session.activeConversation.id, skill, provider)} onPreviewSkill={(skill, provider) => session.previewSkillResource(provider, skill.resourceId)} onRefreshMcp={(resourceId) => session.activeConversation && session.refreshMcpServer(session.activeConversation.id, resourceId)} onCallMcp={(resourceId, toolName) => session.activeConversation && session.callMcpTool(session.activeConversation.id, resourceId, toolName)} /></Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>
      <GitHubModal session={session} isOpen={gitOpen} onOpenChange={setGitOpen} />
      <CreateWorkspaceModal session={session} isOpen={createOpen} onOpenChange={setCreateOpen} />
      <CreateConversationModal
        session={session}
        isOpen={createConversationOpen}
        onOpenChange={setCreateConversationOpen}
      />
    </div>
  );
}

function GitHubModal({ session, isOpen, onOpenChange }: { session: TodeXSession; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const [repos, setRepos] = useState<GitRepositorySummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('Update from TodeX');
  const [loading, setLoading] = useState(false);
  const workspacePath = session.activeWorkspace?.path || session.settings.defaultWorkspacePath;

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const next = await window.todexDesktop.git.scan(workspacePath);
      setRepos(next);
      setSelected(next.filter((repo) => repo.files.length > 0).map((repo) => repo.path));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : 'Git 状态读取失败');
    } finally { setLoading(false); }
  }, [workspacePath]);

  useEffect(() => { if (isOpen) void refresh(); }, [isOpen, refresh]);

  const run = async (action: 'commit' | 'commit-push' | 'push') => {
    if (!selected.length) return;
    setLoading(true);
    try {
      for (const path of selected) await window.todexDesktop.git.run(path, action, message);
      toast.success(action === 'push' ? '已推送' : action === 'commit-push' ? '已提交并推送' : '已创建提交');
      await refresh();
    } catch (error) { toast.danger(error instanceof Error ? error.message : 'Git 操作失败'); }
    finally { setLoading(false); }
  };

  return <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
    <Modal.Backdrop><Modal.Container><Modal.Dialog className="max-h-[90vh] sm:max-w-2xl">
      <Modal.CloseTrigger /><Modal.Header><Modal.Heading className="flex items-center gap-2"><RiGithubLine className="size-5" /> GitHub 操作</Modal.Heading></Modal.Header>
      <Modal.Body className="max-h-[72vh] overflow-y-auto">
        <div className="mb-4 flex items-end gap-3"><TextField className="min-w-0 flex-1" value={message} onChange={setMessage}><Label>提交信息</Label><Input /></TextField><Button size="sm" variant="secondary" onPress={() => void refresh()} isDisabled={loading}>刷新</Button></div>
        {!repos.length && !loading ? <p className="text-muted text-sm">当前路径及其子目录没有 Git 仓库。</p> : null}
        <div className="space-y-2">
          {repos.map((repo) => <div key={repo.path} className="border-separator bg-surface-secondary rounded-lg border p-3">
            <div className="flex items-start gap-3"><Checkbox isSelected={selected.includes(repo.path)} onChange={(checked) => setSelected((current) => checked ? [...new Set([...current, repo.path])] : current.filter((path) => path !== repo.path))} aria-label={`选择 ${repo.name}`} isDisabled={!repo.files.length} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{repo.name}</p><p className="text-muted truncate text-xs">{repo.path} · {repo.branch}</p>
                {repo.error ? <p className="text-danger mt-1 text-xs">{repo.error}</p> : <p className="text-muted mt-1 text-xs">{repo.files.length} 个文件 · +{repo.additions} / -{repo.deletions}</p>}
                {repo.files.length ? <p className="text-muted mt-1 truncate text-xs">{repo.files.slice(0, 4).map((file) => `${file.status} ${file.path}`).join(' · ')}{repo.files.length > 4 ? ' …' : ''}</p> : null}
              </div>
            </div>
          </div>)}
        </div>
      </Modal.Body>
      <Modal.Footer className="flex-wrap justify-end gap-2"><Button variant="secondary" onPress={() => void run('push')} isDisabled={loading || !selected.length}>单推送</Button><Button variant="secondary" onPress={() => void run('commit')} isDisabled={loading || !selected.length}>创建提交</Button><Button onPress={() => void run('commit-push')} isDisabled={loading || !selected.length}>提交并推送</Button></Modal.Footer>
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

function CreateConversationModal({
  session,
  isOpen,
  onOpenChange,
}: {
  session: TodeXSession;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState('');
  const [provider, setProvider] = useState<ProviderKind | ''>('');
  const [profile, setProfile] = useState('');
  const [backendId, setBackendId] = useState(session.activeBackendConnectionId);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const firstAvailable = session.v2Providers.find((item) => item.available);
    const nextProvider = firstAvailable?.id ?? '';
    setTitle('');
    setBackendId(session.activeBackendConnectionId);
    setProvider(nextProvider);
    setProfile(firstAvailable?.profiles[0] ?? '');
  }, [isOpen, session.activeBackendConnectionId, session.v2Providers]);

  const selected = session.v2Providers.find((item) => item.id === provider) ?? null;
  const needsProfile = Boolean(selected && (selected.id === 'acp' || selected.profiles.length > 1));

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>新建对话</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <p className="text-muted text-sm">
                先选 Agent 再创建。任务开始前可在输入框旁改 Agent；发出第一条消息后锁定。
              </p>
              {!session.activeWorkspaceId ? (
                <p className="text-danger text-sm">请先选择一个工作区。</p>
              ) : null}
              <Select selectedKey={backendId} onSelectionChange={(key) => {
                if (typeof key !== 'string') return;
                const backend = session.backendConnections.find((item) => item.id === key);
                if (!backend) return;
                setBackendId(key);
                setProvider('');
                setProfile('');
                session.setActiveBackendConnectionId(key);
                session.setSettings((current) => ({ ...current, serverUrl: backend.serverUrl, authToken: backend.authToken, tenantId: backend.tenantId, encryptionProtocol: backend.encryptionProtocol, encryptionPublicKey: backend.encryptionPublicKey }));
              }}>
                <Label>连接后端</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>{session.backendConnections.map((backend) => <ListBox.Item key={backend.id} id={backend.id} textValue={backend.name}>{backend.name} · {backend.serverUrl}</ListBox.Item>)}</ListBox></Select.Popover>
              </Select>
              <div className="flex flex-wrap gap-2">
                {session.v2Providers.map((item) => (
                  <Button
                    key={item.id}
                    size="sm"
                    variant={provider === item.id ? 'primary' : 'tertiary'}
                    isDisabled={!item.available}
                    onPress={() => {
                      setProvider(item.id);
                      setProfile(item.profiles[0] ?? '');
                    }}
                  >
                    {providerDisplayName(item.id, item.displayName)}
                    {item.available ? '' : ` · ${item.unavailableReason || '不可用'}`}
                  </Button>
                ))}
              </div>
              {selected && !selected.available ? (
                <p className="text-danger text-sm">{selected.unavailableReason || '该 Agent 当前不可用'}</p>
              ) : null}
              {needsProfile ? (
                <div className="flex flex-wrap gap-2">
                  {selected?.profiles.map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant={profile === item ? 'primary' : 'tertiary'}
                      onPress={() => setProfile(item)}
                    >
                      {item}
                    </Button>
                  ))}
                </div>
              ) : null}
              <Field label="标题（可选）" value={title} onChange={setTitle} />
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">取消</Button>
              <Button
                isDisabled={!session.activeWorkspaceId || !selected?.available || (needsProfile && !profile)}
                onPress={() => {
                  if (!session.activeWorkspaceId || !selected?.available) {
                    return;
                  }
                  session.createConversation(session.activeWorkspaceId, {
                    provider: selected.id,
                    providerProfile: needsProfile ? profile || undefined : selected.profiles[0],
                    title: title.trim() || undefined,
                    backendConnectionId: backendId,
                  });
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

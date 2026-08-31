import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, Dropdown, Modal, Toast, toast } from '@heroui/react';
import { AppLayout, Navbar } from '@heroui-pro/react';
import { Ellipsis, Gear, Plus } from '@gravity-ui/icons';
import { useTodeXSession, type TodeXSession } from './session/useTodeXSession';
import { DesktopAlertHost } from './components/DesktopAlertHost';
import { AppSidebar } from './components/AppSidebar';
import { ChatPanel } from './screens/ChatPanel';
import { SettingsPanel } from './screens/SettingsPanel';
import { AsidePanel } from './screens/AsidePanel';
import { WorkbenchPanel } from './screens/WorkbenchPanel';
import { Field } from './components/Field';
import { connectionStateLabel, fetchWorkspaceDirectorySnapshot, healthLabelOf, isV2Conversation } from './session/helpers';
import { providerDisplayName, type ProviderKind } from '@todex/protocol/v2';
import { isWorkbenchTab, panelFromRoute, type DesktopPanel, type OpenPanelOptions, type WorkbenchTab } from './lib/panels';

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function App() {
  const [panel, setPanel] = useState<DesktopPanel | null>(null);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('terminal');
  const [slashCommand, setSlashCommand] = useState<string>();
  const [asideOpen, setAsideOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createConversationOpen, setCreateConversationOpen] = useState(false);

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
    setPanel(next);
    if (isWorkbenchTab(next)) {
      setWorkbenchTab(next);
    }
    if (next !== 'settings') {
      setAsideOpen(true);
    }
  }, []);

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
  const overlayPanel = panel && panel !== 'settings' && !isWorkbenchTab(panel) ? panel : null;

  return (
    <div className="bg-background text-foreground h-full">
      <Toast.Provider />
      <DesktopAlertHost />
      {session.hydrated ? (
        <AppLayout
          className="h-full min-h-0"
          scrollMode="content"
          sidebarCollapsible="none"
          sidebarResizable
          sidebarDefaultSize="248px"
          sidebarMinSize="200px"
          sidebarMaxSize="320px"
          asideResizable
          asideDefaultSize="420px"
          asideMinSize="320px"
          asideMaxSize="640px"
          asideOpen={asideOpen}
          onAsideOpenChange={setAsideOpen}
          aside={
            overlayPanel ? (
              <AsidePanel
                session={session}
                panel={overlayPanel}
                slashCommand={slashCommand}
                onBack={() => setPanel(workbenchTab)}
              />
            ) : (
              <WorkbenchPanel session={session} tab={workbenchTab} onTabChange={setWorkbenchTab} />
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
            />
          }
          navbar={
            <Navbar maxWidth="full">
              <Navbar.Header>
                <AppLayout.MenuToggle />
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
                  {session.activeWorkspaceId ? (
                    <Button
                      size="sm"
                      variant="tertiary"
                      onPress={() => setCreateConversationOpen(true)}
                    >
                      新建对话
                    </Button>
                  ) : null}
                  <Chip size="sm" variant="soft" className="whitespace-nowrap">
                    {session.connectionState === 'open'
                      ? healthLabelOf(session.connectionHealth)
                      : connectionStateLabel(session.connectionState)}
                  </Chip>
                <Dropdown>
                  <Dropdown.Trigger aria-label="更多面板" className="inline-flex size-8 items-center justify-center rounded-lg">
                    <Ellipsis className="size-4" />
                  </Dropdown.Trigger>
                    <Dropdown.Popover>
                      <Dropdown.Menu
                        onAction={(key) => {
                          const id = String(key);
                          if (id === 'terminal' || id === 'browser' || id === 'files') {
                            setWorkbenchTab(id);
                            setPanel(id);
                            setAsideOpen(true);
                            return;
                          }
                          setPanel(id as DesktopPanel);
                          setAsideOpen(true);
                        }}
                      >
                        <Dropdown.Item id="slash-commands" textValue="斜杠命令">斜杠命令</Dropdown.Item>
                        <Dropdown.Item id="capabilities" textValue="能力">Skills / MCP</Dropdown.Item>
                        <Dropdown.Item id="experimental" textValue="实验">实验功能</Dropdown.Item>
                        <Dropdown.Item id="v2" textValue="2.0">TodeX 2.0</Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="设置" onPress={() => setPanel('settings')}>
                    <Gear className="size-4" />
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
      <CreateWorkspaceModal session={session} isOpen={createOpen} onOpenChange={setCreateOpen} />
      <CreateConversationModal
        session={session}
        isOpen={createConversationOpen}
        onOpenChange={setCreateConversationOpen}
      />
    </div>
  );
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
  const [entries, setEntries] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const defaultPath = session.settings.defaultWorkspacePath;
    const backendRoot = session.serverVersion?.workspace_root || '';
    setPath(defaultPath);
    void fetchWorkspaceDirectorySnapshot(session.settings, defaultPath)
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
          const snapshot = await fetchWorkspaceDirectorySnapshot(session.settings, backendRoot);
          setPath(snapshot.current);
          setEntries(snapshot.entries.map((entry) => entry.path));
        } catch {
          setEntries([]);
        }
      });
  }, [isOpen, session.serverVersion?.workspace_root, session.settings]);

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
                      const snapshot = await fetchWorkspaceDirectorySnapshot(session.settings, path);
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
                      validatedPath = (await session.fetchWorkspaceDirectorySnapshot(path)).current;
                    } catch (error) {
                      toast.danger(error instanceof Error ? error.message : '无法读取目录');
                      return;
                    }
                  }
                  session.createWorkspace(name || validatedPath, validatedPath);
                  onOpenChange(false);
                }}
              >
                <Plus className="size-4" />
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

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const firstAvailable = session.v2Providers.find((item) => item.available);
    const nextProvider = firstAvailable?.id ?? '';
    setTitle('');
    setProvider(nextProvider);
    setProfile(firstAvailable?.profiles[0] ?? '');
  }, [isOpen, session.v2Providers]);

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
                  });
                  onOpenChange(false);
                }}
              >
                <Plus className="size-4" />
                创建
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { RiAppsLine, RiCloseLine, RiDeleteBinLine, RiDownload2Line, RiEdit2Line, RiFolderAddLine, RiLinksLine, RiLink, RiServerLine, RiTerminalBoxLine, RiTerminalWindowLine, RiUpload2Line, RiGitBranchLine, RiAddLine, RiArrowLeftDoubleLine, RiArrowRightDoubleLine, RiExternalLinkLine, RiFileTextLine, RiFolder3Line, RiFolderOpenLine, RiGlobalLine, RiFocus3Line, RiLayoutColumnLine, RiLayoutRowLine, RiRefreshLine, RiStopCircleLine } from '@remixicon/react';
import { AlertDialog, Button, Chip, Dropdown, Input, Label, Modal, Popover, ScrollShadow, Spinner, TextField, Tooltip, toast } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { ContextMenu as HeroContextMenu, FileTree } from '@heroui-pro/react';
import { Resizable } from '@heroui-pro/react/resizable';
import type { PanelImperativeHandle } from '@heroui-pro/react/resizable';
import { WorkspaceFilePreview, type PreviewFile, type ReferenceSelection, type WorkspaceFileSaveOutcome } from '../components/WorkspaceFilePreview';
import { useNoticeToast } from '../components/NoticeToast';
import { XtermTerminal } from '../components/XtermTerminal';
import { SshExecPane } from '../components/ssh/SshExecPane';
import { capSshExecTabs, rememberSessionSshExecTabs, sessionSshExecTabsFor, sshExecTabTitle } from '../session/sshExecTabs';
import type { TodeXSession } from '../session/useTodeXSession';
import { useRemoteConnector } from '../components/ssh/useRemoteConnector';
import { normalizeRemoteFilesBinding, remoteFileSource, remoteFilesBinding, workspaceFileSource, type FileSource, type FileSourceEntry, type RemoteFilesBinding } from '../session/fileSources';
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  latencyLabelOf,
  terminalIdForConversation,
  terminalStatusLabel,
  type TerminalTarget,
} from '../session/helpers';
import type { OpenPanelOptions, WorkbenchItem, WorkbenchRequest, WorkbenchTab } from '../lib/panels';
import { normalizeWorkbenchLayout } from '../session/workbenchLayout';
import { SETTINGS_STORAGE_KEY, attachmentId, referenceToken, uniqueReferenceName } from '../session/helpers';
import { V2ApiClient } from '@todex/protocol/v2';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { isConflictError } from '@todex/protocol/connectionError';
import { isNotFoundError } from '@todex/protocol/ssh';
import { isLoopbackUrl } from '@todex/protocol/mobileParity';
import { t, useT, type MessageKey } from '../i18n';

type Props = {
  scopeKey?: string;
  onTargetConsumed?: () => void;
  session: TodeXSession;
  tab: WorkbenchTab;
  target?: OpenPanelOptions;
  onTabChange: (tab: WorkbenchTab) => void;
  closeRequestRef?: RefObject<() => boolean>;
  /** SSH view scope: tabs are opened from the SSH view, not the + menu. */
  sshMode?: boolean;
  /** Ordered queue; ids increase monotonically. */
  requests?: WorkbenchRequest[];
  /** Every request with an id up to and including this one was applied. */
  onRequestsHandled?: (lastId: number) => void;
  onItemsChange?: (items: WorkbenchItem[]) => void;
};

type StoredWorkbenchState = {
  items: WorkbenchItem[];
  activeId: string;
};

/** Types written to the tab store; 'ssh-exec' tabs are session-only. */
const WORKBENCH_TYPES = new Set<WorkbenchTab>(['terminal', 'browser', 'files', 'git-diff']);

const WORKBENCH_LABEL_KEYS: Record<WorkbenchTab, MessageKey> = {
  terminal: 'workbench.tabTerminal',
  browser: 'workbench.tabBrowser',
  files: 'workbench.tabFiles',
  'git-diff': 'workbench.tabGitDiff',
  'ssh-exec': 'workbench.tabSshExec',
};

const workbenchLabel = (tab: WorkbenchTab) => t(WORKBENCH_LABEL_KEYS[tab]);

const WORKBENCH_ICONS = {
  terminal: RiTerminalBoxLine,
  browser: RiGlobalLine,
  files: RiFileTextLine,
  'git-diff': RiGitBranchLine,
  'ssh-exec': RiTerminalWindowLine,
};

const REMOTE_ICONS = {
  terminal: RiServerLine,
  files: RiFolder3Line,
};

type WorkbenchTabAxis = 'horizontal' | 'vertical';

const WORKBENCH_TAB_AXIS_KEY = `${SETTINGS_STORAGE_KEY}.workbenchTabAxis.v1`;

/** `sessionItems` are this app session's 'ssh-exec' tabs for the scope; they
 * follow the stored tabs and may hold the stored active tab. */
function parseStoredWorkbenchState(value: unknown, sessionItems: WorkbenchItem[] = []): StoredWorkbenchState {
  if (!value || typeof value !== 'object') return { items: sessionItems, activeId: sessionItems[0]?.id ?? '' };
  const candidate = value as Partial<StoredWorkbenchState>;
  const seen = new Set<string>();
  const items = Array.isArray(candidate.items)
    ? candidate.items.filter((item): item is WorkbenchItem => {
      if (!item || typeof item !== 'object') return false;
      const entry = item as Partial<WorkbenchItem>;
      if (typeof entry.id !== 'string' || seen.has(entry.id)) return false;
      if (typeof entry.title !== 'string' || !WORKBENCH_TYPES.has(entry.type as WorkbenchTab)) return false;
      seen.add(entry.id);
      return true;
    })
    : [];
  const restored = [...items.map(normalizeWorkbenchItem), ...sessionItems.filter(item => !seen.has(item.id))];
  const activeId = typeof candidate.activeId === 'string' && restored.some((item) => item.id === candidate.activeId)
    ? candidate.activeId
    : restored[0]?.id ?? '';
  return { items: restored, activeId };
}

function normalizeWorkbenchItem(item: WorkbenchItem): WorkbenchItem {
  const host = item.type === 'terminal' && typeof item.ssh?.host === 'string' ? item.ssh.host.trim() : '';
  const remote = item.type === 'files' ? normalizeRemoteFilesBinding(item.remote) : undefined;
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    target: normalizeWorkbenchLayout({ target: item.target }).target,
    ...(host ? { ssh: { host } } : {}),
    ...(remote ? { remote } : {}),
  };
}

function v2Api(session: TodeXSession) {
  return new V2ApiClient({ serverUrl: session.settings.serverUrl, device: deviceIdentityFromSecret(session.settings.deviceSecret) });
}

function placeholderFiles(): Record<string, { title: string; language: string; body: string }> {
  return {
    readme: {
      title: 'README.md',
      language: 'markdown',
      body: t('workbench.placeholderReadme'),
    },
    agent: {
      title: 'AGENTS.md',
      language: 'markdown',
      body: t('workbench.placeholderAgents'),
    },
    package: {
      title: 'package.json',
      language: 'json',
      body: '{\n  "name": "workspace",\n  "private": true\n}',
    },
  };
}

export function WorkbenchPanel({ session, tab, target, onTabChange, scopeKey = session.activeConversation?.id || '', onTargetConsumed, closeRequestRef, sshMode = false, requests, onRequestsHandled, onItemsChange }: Props) {
  const t = useT();
  const storageKey = `${SETTINGS_STORAGE_KEY}.workbenchTabs.v1:${scopeKey}`;
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [restored, setRestored] = useState(false);
  const [axis, setAxis] = useState<WorkbenchTabAxis>('vertical');
  const requestedTargetRef = useRef(target);
  const openedTargetRef = useRef<{ target: OpenPanelOptions; tab: WorkbenchTab } | null>(null);
  requestedTargetRef.current = target;

  useEffect(() => {
    let cancelled = false;
    void window.todexDesktop.store.get(storageKey)
      .then((value) => {
        if (cancelled) return;
        const stored = parseStoredWorkbenchState(value, sessionSshExecTabsFor(storageKey));
        setItems(stored.items);
        setActiveId(stored.activeId);
        const active = stored.items.find((item) => item.id === stored.activeId);
        if (active && !requestedTargetRef.current?.filePath && !requestedTargetRef.current?.url) onTabChange(active.type);
      })
      .catch((reason) => {
        console.error('Failed to restore workbench tabs', reason);
      })
      .finally(() => {
        if (!cancelled) setRestored(true);
      });
    return () => { cancelled = true; };
  }, [onTabChange, storageKey]);

  useEffect(() => {
    if (!restored) return;
    rememberSessionSshExecTabs(storageKey, items);
    const persisted = items.filter(item => item.type !== 'ssh-exec').map(normalizeWorkbenchItem);
    void window.todexDesktop.store.set(storageKey, { items: persisted, activeId } satisfies StoredWorkbenchState)
      .catch((reason) => {
        console.error('Failed to persist workbench tabs', reason);
      });
  }, [activeId, items, restored, storageKey]);

  useEffect(() => {
    if (!restored) return;
    if (items.some(item => item.id === activeId && item.type === tab)) return;
    const next = items.find((item) => item.type === tab);
    if (next && next.id !== activeId) {
      setActiveId(next.id);
    }
  }, [activeId, items, restored, tab]);

  useEffect(() => {
    if (!restored || !target || !(tab === 'files' && target.filePath
      || tab === 'browser' && (target.url || target.filePath))) return;
    if (openedTargetRef.current?.target === target && openedTargetRef.current.tab === tab) return;
    openedTargetRef.current = { target, tab };
    const existing = items.find(item => item.id === activeId && item.type === tab) ?? items.find(item => item.type === tab);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const item = { id: `${tab}-${Date.now()}`, type: tab, title: `${workbenchLabel(tab)} 1` };
    setItems(current => [...current, item]);
    setActiveId(item.id);
    // Consume an explicit open request, including repeated clicks on one path.
    // Tab-list changes alone must not steal focus from a manually selected tab.
  }, [restored, tab, target]);

  const updateTabTarget = useCallback((id: string, nextTarget: OpenPanelOptions) => {
    setItems(current => current.some(item => item.id === id && item.target !== nextTarget)
      ? current.map(item => item.id === id ? { ...item, target: nextTarget } : item) : current);
    if (id === activeId && items.some(item => item.id === id && item.type === tab)
      && nextTarget === requestedTargetRef.current) onTargetConsumed?.();
  }, [activeId, items, onTargetConsumed, tab]);

  const active = items.find((item) => item.id === activeId) ?? null;
  const workspace = session.activeWorkspace;
  const conversation = session.activeConversation;
  // Identity follows the workspace/conversation records, so terminal effects
  // re-run exactly when they did before targets were introduced.
  const workspaceTerminalTarget = useMemo<TerminalTarget | null>(
    () => (workspace && conversation ? { kind: 'workspace', workspace, conversation } : null),
    [conversation, workspace],
  );
  const addTab = (type: WorkbenchTab) => {
    if (!restored) return;
    const count = items.filter((item) => item.type === type).length + 1;
    const item = { id: `${type}-${Date.now()}`, type, title: `${workbenchLabel(type)} ${count}` };
    setItems((current) => [...current, item]);
    setActiveId(item.id);
    onTabChange(type);
  };
  const removeTab = useCallback((id: string) => {
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      if (id === activeId) {
        const replacement = next[Math.max(0, current.findIndex((item) => item.id === id) - 1)] ?? next[0];
        setActiveId(replacement?.id ?? '');
        if (replacement) onTabChange(replacement.type);
      }
      return next;
    });
  }, [activeId, onTabChange]);

  // Closing a terminal tab that holds a live PTY stops the backend PTY
  // instead of leaving it running in the background; closing a remote files
  // tab closes its backend connection.
  const closeTab = useCallback((id: string) => {
    const item = items.find((entry) => entry.id === id);
    const terminal = item?.type === 'terminal' ? session.terminalById[terminalIdForConversation(scopeKey, id)] : undefined;
    if (item && terminal && (terminal.status === 'running' || terminal.status === 'starting' || terminal.status === 'stopping')) {
      session.stopTerminalSession(terminalIdForConversation(scopeKey, id), item.ssh ? session.settings.tenantId : session.activeWorkspace?.tenantId || session.settings.tenantId);
    }
    if (item?.remote) {
      const { connectionId, label } = item.remote;
      void v2Api(session).closeRemoteConnection(connectionId).catch((reason) => {
        // Already dropped by the backend (idle timeout or restart) is fine.
        if (isNotFoundError(reason)) return;
        toast.danger(t('ssh.remote.closeFailed', { label, error: reason instanceof Error ? reason.message : String(reason) }));
      });
    }
    removeTab(id);
  }, [items, removeTab, scopeKey, session, t]);

  const updateRemoteBinding = useCallback((id: string, remote: RemoteFilesBinding) => {
    setItems(current => current.map(item => item.id === id ? { ...item, remote, title: remote.label } : item));
  }, []);

  useEffect(() => { onItemsChange?.(items); }, [items, onItemsChange]);

  const sshExecRun = useCallback((item: WorkbenchItem) => item.sshExec
    ? session.conversationRuntimeById[item.sshExec.conversationId]?.sshExecs.find(run => run.id === item.sshExec!.execId)
    : undefined, [session.conversationRuntimeById]);
  const isSshExecRunning = useCallback((item: WorkbenchItem) => sshExecRun(item)?.status === 'running', [sshExecRun]);

  const handledRequestRef = useRef(0);
  /** SSH tabs opened during this mount connect at once; restored ones wait for Connect. */
  const freshSshTabsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!restored || !requests?.length) return;
    const pending = requests.filter(request => request.id > handledRequestRef.current);
    if (!pending.length) return;
    handledRequestRef.current = pending[pending.length - 1].id;
    onRequestsHandled?.(handledRequestRef.current);
    let opened: WorkbenchItem | null = null;
    const added: WorkbenchItem[] = [];
    for (const request of pending) {
      if (request.kind === 'close') {
        if (items.some(item => item.id === request.itemId)) closeTab(request.itemId);
        continue;
      }
      if (request.kind === 'ssh-exec') {
        const binding = { conversationId: request.conversationId, execId: request.execId };
        const existing = [...items, ...added].find(item => item.sshExec?.conversationId === binding.conversationId && item.sshExec.execId === binding.execId);
        if (existing) {
          opened = existing;
          continue;
        }
        const item: WorkbenchItem = { id: `ssh-exec-${Date.now()}-${request.id}`, type: 'ssh-exec', title: request.title, sshExec: binding };
        added.push(item);
        opened = item;
        continue;
      }
      const id = `${request.kind === 'ssh-terminal' ? 'terminal' : 'files'}-${Date.now()}-${request.id}`;
      const item: WorkbenchItem = request.kind === 'ssh-terminal'
        ? { id, type: 'terminal', title: request.host, ssh: { host: request.host } }
        : { id, type: 'files', title: request.remote.label, remote: request.remote };
      if (item.ssh) freshSshTabsRef.current.add(item.id);
      added.push(item);
      opened = item;
    }
    if (added.length) {
      const keep = new Set(added.map(item => item.id));
      setItems(current => capSshExecTabs([...current, ...added], isSshExecRunning, keep));
    }
    if (opened) {
      setActiveId(opened.id);
      onTabChange(opened.type);
    }
  }, [closeTab, isSshExecRunning, items, onRequestsHandled, onTabChange, requests, restored]);

  const closeActiveTab = useCallback(() => {
    if (!activeId) return false;
    closeTab(activeId);
    return true;
  }, [activeId, closeTab]);

  useEffect(() => {
    if (!closeRequestRef) return undefined;
    closeRequestRef.current = closeActiveTab;
    return () => { closeRequestRef.current = () => false; };
  }, [closeRequestRef, closeActiveTab]);

  useEffect(() => {
    let cancelled = false;
    void window.todexDesktop.store.get(WORKBENCH_TAB_AXIS_KEY)
      .then((value) => {
        if (!cancelled && (value === 'horizontal' || value === 'vertical')) setAxis(value);
      })
      .catch((reason) => {
        console.error('Failed to restore workbench tab axis', reason);
      });
    return () => { cancelled = true; };
  }, []);

  const vertical = axis === 'vertical';
  const axisLabel = vertical ? t('workbench.tabsHorizontal') : t('workbench.tabsVertical');
  const toggleAxis = () => {
    const next: WorkbenchTabAxis = vertical ? 'horizontal' : 'vertical';
    setAxis(next);
    void window.todexDesktop.store.set(WORKBENCH_TAB_AXIS_KEY, next)
      .catch((reason) => {
        console.error('Failed to persist workbench tab axis', reason);
      });
  };

  const tabStrip = items.map((item) => {
    const Icon = item.ssh || item.remote ? REMOTE_ICONS[item.type === 'terminal' ? 'terminal' : 'files'] : WORKBENCH_ICONS[item.type];
    const workspacePath = session.activeWorkspace?.path;
    const execRun = item.type === 'ssh-exec' ? sshExecRun(item) : undefined;
    const location = item.type === 'ssh-exec'
      ? (execRun && sshExecTabTitle(execRun)) || item.title
      : item.ssh
      ? `ssh ${item.ssh.host}`
      : item.remote
        ? `${item.remote.label}${item.target?.filePath ? ` ${item.target.filePath}` : ''}`
        : item.type === 'terminal'
          ? session.terminalById[terminalIdForConversation(scopeKey, item.id)]?.cwd || workspacePath
          : item.type === 'browser'
            ? item.target?.url || item.target?.filePath || 'http://127.0.0.1:7345'
            : item.target?.filePath || workspacePath;
    const title = location ? `${workbenchLabel(item.type)} ${location}` : item.title;
    const isActive = item.id === activeId;
    return (
      <div
        key={item.id}
        className={vertical
          ? 'group relative flex size-10 shrink-0 items-center justify-center'
          : `group relative flex h-10 shrink-0 items-center border-r border-separator ${isActive ? 'bg-surface text-foreground' : 'text-muted'}`}
      >
        <Tooltip delay={200}>
          <Button
            isIconOnly variant="ghost" aria-label={title} aria-pressed={isActive}
            className={vertical
              ? `size-9 min-w-9 rounded-lg ${isActive ? 'bg-surface-secondary text-foreground' : 'text-muted'}`
              : 'size-10 min-w-10 rounded-none text-inherit'}
            onPress={() => { setActiveId(item.id); onTabChange(item.type); }}
          >
            <Icon aria-hidden="true" className={`size-4 transition-opacity${isActive ? ' group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-0' : ''}`} />
          </Button>
          <Tooltip.Content placement={vertical ? 'right' : 'bottom'} className="max-w-sm break-all text-xs">
            {title}
          </Tooltip.Content>
        </Tooltip>
        <Button
          isIconOnly size="sm" variant="ghost" aria-label={t('workbench.closeTab', { title })}
          className={`pointer-events-none absolute inset-0 m-auto size-6 min-w-6 rounded-md text-muted opacity-0 transition-opacity${isActive ? ' group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100' : ''}`}
          onPress={() => closeTab(item.id)}
        >
          <RiCloseLine aria-hidden="true" className="size-4" />
        </Button>
      </div>
    );
  });

  const newTabDropdown = (
    <Dropdown>
      <Dropdown.Trigger
        isDisabled={!restored} aria-label={t('workbench.newTab')}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
      >
        <RiAddLine className="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu onAction={(key) => addTab(String(key) as WorkbenchTab)}>
          <Dropdown.Item id="terminal" textValue={t('workbench.tabTerminal')}>{t('workbench.tabTerminal')}</Dropdown.Item>
          <Dropdown.Item id="browser" textValue={t('workbench.tabBrowser')}>{t('workbench.tabBrowser')}</Dropdown.Item>
          <Dropdown.Item id="files" textValue={t('workbench.tabFiles')}>{t('workbench.tabFiles')}</Dropdown.Item>
          <Dropdown.Item id="git-diff" textValue="Git Diff">Git Diff</Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );

  const axisToggle = (
    <Tooltip delay={200}>
      <Button
        isIconOnly variant="ghost" aria-label={axisLabel}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
        onPress={toggleAxis}
      >
        {vertical ? <RiLayoutRowLine className="size-4" /> : <RiLayoutColumnLine className="size-4" />}
      </Button>
      <Tooltip.Content placement={vertical ? 'right' : 'bottom'} className="text-xs">
        {axisLabel}
      </Tooltip.Content>
    </Tooltip>
  );

  return (
    <div className={`flex h-full min-h-0${vertical ? '' : ' flex-col'}`}>
      <div className={vertical
        ? 'flex w-11 shrink-0 flex-col border-r border-separator'
        : 'flex min-h-10 items-center border-b border-separator px-2'}
      >
        <div className={vertical
          ? 'flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto py-1'
          : 'flex min-w-0 flex-1 overflow-x-auto'}
        >
          {tabStrip}
          {vertical && !sshMode ? newTabDropdown : null}
        </div>
        {vertical ? (
          <div className="flex items-center justify-center py-1.5">{axisToggle}</div>
        ) : (
          <>
            {sshMode ? null : newTabDropdown}
            {axisToggle}
          </>
        )}
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {!active ? (
          <div className="text-muted flex h-full items-center justify-center px-6 text-center text-sm">{sshMode ? t('ssh.workbenchEmpty') : t('workbench.noTabs')}</div>
        ) : null}
        {items.map((item) => (
          <div key={item.id} className={item.id === active?.id ? 'h-full' : 'hidden'}>
            {item.type === 'terminal' ? (
              <TerminalPane
                isActive={item.id === active?.id}
                session={session}
                terminalId={terminalIdForConversation(scopeKey, item.id)}
                workspaceTarget={workspaceTerminalTarget}
                sshHost={item.ssh?.host}
                autoConnect={!item.ssh || freshSshTabsRef.current.has(item.id)}
              />
            ) : null}
            {item.type === 'browser' ? <BrowserPane workspacePath={session.activeWorkspace?.path} session={session} target={item.type === tab && item.id === active?.id && (target?.filePath || target?.url) ? target : item.target} onTargetChange={next => updateTabTarget(item.id, next)} /> : null}
            {item.type === 'files' ? <FilesPane session={session} remote={item.remote} onRemoteRebind={next => updateRemoteBinding(item.id, next)} target={item.type === tab && item.id === active?.id && (target?.filePath || target?.url) ? target : item.target} onTargetChange={next => updateTabTarget(item.id, next)} /> : null}
            {item.type === 'git-diff' ? <GitDiffPane session={session} /> : null}
            {item.type === 'ssh-exec' ? <SshExecPane run={sshExecRun(item)} isActive={item.id === active?.id} onClose={() => closeTab(item.id)} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalPane({ session, terminalId, isActive, workspaceTarget, sshHost, autoConnect = true }: {
  session: TodeXSession;
  terminalId: string;
  isActive: boolean;
  workspaceTarget: TerminalTarget | null;
  /** Set for SSH tabs: the terminal runs `ssh -tt <host>` on the backend. */
  sshHost?: string;
  /** False for restored SSH tabs: they reattach to a live session but only
   * start `ssh` (and its password/host-key prompts) on an explicit Connect. */
  autoConnect?: boolean;
}) {
  const t = useT();
  const target = useMemo<TerminalTarget | null>(
    () => (sshHost ? { kind: 'ssh', host: sshHost } : workspaceTarget),
    [sshHost, workspaceTarget],
  );
  const workspace = target?.kind === 'workspace' ? target.workspace : null;
  const isSsh = target?.kind === 'ssh';
  const targetKey = !target ? '' : target.kind === 'ssh' ? `ssh:${target.host}` : target.conversation.id;
  const tenantId = workspace?.tenantId || session.settings.tenantId;
  const backendIdentity = workspace?.backendConnectionId || session.activeBackendConnectionId || session.settings.serverUrl;
  const autoStartAttempts = useRef(new Set<string>());
  const manualStopRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const statusCheckTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const terminalByIdRef = useRef(session.terminalById);
  const terminalSizeRef = useRef({ rows: DEFAULT_TERMINAL_ROWS, cols: DEFAULT_TERMINAL_COLS });
  const terminal = terminalId ? session.terminalById[terminalId] : undefined;

  terminalByIdRef.current = session.terminalById;

  useEffect(() => {
    autoStartAttempts.current.clear();
    manualStopRef.current = false;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (statusCheckTimerRef.current !== null) {
      window.clearTimeout(statusCheckTimerRef.current);
      statusCheckTimerRef.current = null;
    }
  }, [terminalId, backendIdentity]);

  useEffect(() => {
    if (!terminal) return;
    terminalSizeRef.current = { rows: terminal.rows, cols: terminal.cols };
  }, [terminal?.cols, terminal?.rows]);

  useEffect(() => {
    if (!target || !terminalId || session.connectionState !== 'open') {
      return;
    }
    const current = terminalByIdRef.current[terminalId];
    if (current && current.status !== 'idle') {
      return;
    }
    const attemptKey = `${targetKey}:${terminalId}`;
    if (autoStartAttempts.current.has(attemptKey)) {
      return;
    }
    autoStartAttempts.current.add(attemptKey);
    session.requestTerminalStatus(target, terminalId);
    const timeoutId = window.setTimeout(() => {
      const latest = terminalByIdRef.current[terminalId];
      if ((!latest || latest.status === 'idle') && (!isSsh || autoConnect)) {
        const size = terminalSizeRef.current;
        session.startTerminalSession(target, {
          terminalId,
          cwd: workspace?.path ?? '',
          shell: '',
          rows: size.rows,
          cols: size.cols,
        });
      }
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [
    autoConnect,
    isSsh,
    targetKey,
    session.connectionState,
    session.requestTerminalStatus,
    session.startTerminalSession,
    terminalId,
    workspace?.id,
    workspace?.path,
  ]);

  // Mirror the mobile client: the backoff counter only resets after the PTY
  // stayed up for a stable window, so a shell that exits on launch cannot
  // crash-loop at the minimum delay.
  useEffect(() => {
    if (terminal?.status !== 'running') {
      return;
    }
    const timer = window.setTimeout(() => {
      reconnectAttemptRef.current = 0;
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [terminal?.status]);

  // Local shells restart automatically. SSH sessions do not: an exit is
  // usually a deliberate `exit` or a failed login, and retrying would loop
  // through password or host-key prompts; the Reconnect button restarts them.
  useEffect(() => {
    if (!target || isSsh || !terminalId || session.connectionState !== 'open' || manualStopRef.current) {
      return;
    }
    if (terminal?.status !== 'error' && terminal?.status !== 'exited') {
      return;
    }
    if (terminal.stopRequested) {
      return;
    }
    if (reconnectTimerRef.current !== null) {
      return;
    }
    const delay = Math.min(10_000, 1000 * 2 ** reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      // Ask the backend first — another client may already hold a live PTY
      // under this id, in which case terminal.status flips us back to running
      // and restarting would spawn a duplicate shell.
      session.requestTerminalStatus(target, terminalId);
      statusCheckTimerRef.current = window.setTimeout(() => {
        statusCheckTimerRef.current = null;
        if (manualStopRef.current) {
          return;
        }
        const latest = terminalByIdRef.current[terminalId];
        if (latest?.status !== 'error' && latest?.status !== 'exited' && latest?.status !== 'idle') {
          return;
        }
        if (latest?.stopRequested) {
          return;
        }
        const size = terminalSizeRef.current;
        session.startTerminalSession(target, {
          terminalId,
          cwd: latest?.cwd || workspace?.path || '',
          shell: latest?.shell || '',
          rows: size.rows,
          cols: size.cols,
          preserveOutput: true,
        });
      }, 300);
    }, delay);
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (statusCheckTimerRef.current !== null) {
        window.clearTimeout(statusCheckTimerRef.current);
        statusCheckTimerRef.current = null;
      }
    };
  }, [target, isSsh, session.connectionState, session.requestTerminalStatus, session.startTerminalSession, terminal?.status, terminal?.stopRequested, terminalId, workspace]);

  const handleTerminalData = useCallback((data: string) => {
    const current = terminalByIdRef.current[terminalId];
    if (!target || !current || current.status !== 'running') return;
    session.sendTerminalInput(terminalId, tenantId, data);
  }, [session.sendTerminalInput, target, tenantId, terminalId]);

  const handleTerminalResize = useCallback((rows: number, cols: number) => {
    terminalSizeRef.current = { rows, cols };
    const current = terminalByIdRef.current[terminalId];
    if (!target || !current || current.status !== 'running') return;
    if (current.rows === rows && current.cols === cols) return;
    session.resizeTerminalSession(terminalId, tenantId, rows, cols);
  }, [session.resizeTerminalSession, target, tenantId, terminalId]);

  const defaultPath = workspace?.path || '';
  const [cwdDraft, setCwdDraft] = useState(defaultPath);

  useEffect(() => {
    setCwdDraft(workspace?.path || '');
  }, [workspace?.path]);

  const handleCwdSubmit = (targetPath: string) => {
    const trimmed = targetPath.trim();
    if (!trimmed || !terminalId || !workspace) return;
    session.sendTerminalInput(terminalId, tenantId, `cd "${trimmed.replace(/"/g, '\\"')}"\r`);
  };

  const sshEnded = isSsh && (
    terminal?.status === 'exited'
    || terminal?.status === 'error'
    || (!autoConnect && (!terminal || terminal.status === 'idle'))
  );
  const reconnectSsh = () => {
    if (!target || !terminalId) return;
    manualStopRef.current = false;
    const size = terminalSizeRef.current;
    session.startTerminalSession(target, { terminalId, cwd: '', shell: '', rows: size.rows, cols: size.cols, preserveOutput: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        {isSsh ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <RiServerLine className="text-muted size-4 shrink-0" />
            <span className="truncate text-sm font-medium">{sshHost}</span>
            {terminal ? <Chip size="sm" variant="soft">{terminalStatusLabel(terminal.status)}</Chip> : null}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCwdSubmit(cwdDraft);
            }}
            className="min-w-0 flex-1"
          >
            <TextField aria-label={t('workbench.terminalPath')} className="w-full" value={cwdDraft} onChange={setCwdDraft}>
              <Input
                placeholder="/path/to/directory..."
                className="text-xs"
              />
            </TextField>
          </form>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <Chip size="sm" variant="soft">
            {session.connectionState === 'open'
              ? session.connectionHealth.latencyMs === null ? t('workbench.detecting') : latencyLabelOf(session.connectionHealth.latencyMs)
              : t('workbench.disconnected')}
          </Chip>
          {sshEnded ? (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={session.connectionState !== 'open'}
              onPress={reconnectSsh}
              aria-label={t('ssh.terminal.reconnect')}
              className="expandable-action-btn"
            >
              <span className="expandable-action-btn__icon">
                <RiRefreshLine className="size-4" />
              </span>
              <span className="expandable-action-btn__label">{t('ssh.terminal.reconnect')}</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="danger-soft"
              isDisabled={!terminalId || !terminal || terminal.status === 'exited'}
              onPress={() => {
                manualStopRef.current = true;
                if (reconnectTimerRef.current !== null) {
                  window.clearTimeout(reconnectTimerRef.current);
                  reconnectTimerRef.current = null;
                }
                if (statusCheckTimerRef.current !== null) {
                  window.clearTimeout(statusCheckTimerRef.current);
                  statusCheckTimerRef.current = null;
                }
                if (terminalId) {
                  session.stopTerminalSession(terminalId, tenantId);
                }
              }}
              aria-label={t('workbench.stopTerminal')}
              className="expandable-action-btn"
            >
              <span className="expandable-action-btn__icon">
                <RiStopCircleLine className="size-4" />
              </span>
              <span className="expandable-action-btn__label">{t('workbench.stop')}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="bg-surface-secondary min-h-0 flex-1 overflow-hidden rounded-xl border border-separator">
        <XtermTerminal
          entries={terminal?.output ?? []}
          isActive={isActive}
          isDisabled={!target || terminal?.status !== 'running'}
          onData={handleTerminalData}
          onResize={handleTerminalResize}
        />
      </div>
    </div>
  );
}

function BrowserPane({ workspacePath, session, target, onTargetChange }: { workspacePath?: string; session: TodeXSession; target?: OpenPanelOptions; onTargetChange?: (target: OpenPanelOptions) => void }) {
  const t = useT();
  const targetChangeRef = useRef(onTargetChange);
  targetChangeRef.current = onTargetChange;
  // Every URL source (typed, chat link, restored layout) must stay loopback.
  const targetUrl = target?.url && isLoopbackUrl(target.url) ? target.url : undefined;
  const defaultUrl = targetUrl ? targetUrl : (target?.filePath ? '' : 'http://127.0.0.1:7345');
  const [draft, setDraft] = useState(defaultUrl || 'http://127.0.0.1:7345');
  const [url, setUrl] = useState(defaultUrl);
  const [srcDoc, setSrcDoc] = useState('');
  const [error, setError] = useState('');
  const [inspect, setInspect] = useState(false);
  // State rather than a ref: the iframe is recreated whenever the page is
  // (re)loaded, and the element picker has to re-attach to the new one.
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const selectedRef = useRef<HTMLElement | null>(null);
  const selectionAnchorRef = useRef<HTMLElement | null>(null);
  useNoticeToast(error, { variant: 'danger', scope: workspacePath });

  const navigateTo = useCallback((input: string) => {
    const trimmed = input.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(t('workbench.httpOnly'));
      if (!isLoopbackUrl(parsed)) throw new Error(t('workbench.loopbackOnly'));
      setUrl(parsed.toString());
      setDraft(parsed.toString());
      targetChangeRef.current?.({ url: parsed.toString() });
      setSrcDoc('');
      setError('');
    } catch (reason) {
      toast.danger(reason instanceof Error ? reason.message : t('workbench.invalidUrl'));
    }
  }, []);

  const handleReload = () => {
    if (frame) {
      if (url) {
        frame.src = url;
      } else if (srcDoc) {
        frame.srcdoc = srcDoc;
      }
    }
  };

  useEffect(() => {
    if (target?.url) {
      if (!isLoopbackUrl(target.url)) {
        setError(t('workbench.loopbackOnly'));
        return;
      }
      targetChangeRef.current?.(target);
      setDraft(target.url);
      setUrl(target.url);
      setSrcDoc('');
      setError('');
      return;
    }
    if (!target?.filePath) return;
    targetChangeRef.current?.(target);
    setDraft(target.filePath);
    setUrl('');
    setSrcDoc('');
    setError('');
    const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, device: deviceIdentityFromSecret(session.settings.deviceSecret) });
    void api.readWorkspaceFile(target.filePath)
      .then((file) => {
        if (!file.text) throw new Error(t('workbench.webFileNotText'));
        setSrcDoc(file.text);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('workbench.webFileReadFailed')));
  }, [session.settings.deviceSecret, session.settings.serverUrl, target?.filePath, target?.url]);

  const appendReference = useCallback((element: HTMLElement) => {
    const tag = element.tagName.toLowerCase();
    const text = (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    const id = element.id ? `#${element.id}` : '';
    const reference = t('workbench.webElement', { tag, id, text: text ? `: ${text}` : '' });
    const conversationId = session.activeConversation?.id;
    if (conversationId) {
      session.setConversationChatDraft(conversationId, (current) => `${current}${current ? '\n' : ''}${reference}`);
    }
  }, [session.activeConversation?.id, session.setConversationChatDraft]);

  useEffect(() => {
    if (!frame || !inspect) return;
    const bind = () => {
      try {
        const doc = frame.contentDocument;
        const frameWindow = frame.contentWindow;
        if (!doc || !frameWindow) return;
        const FrameHTMLElement = (frameWindow as Window & typeof globalThis).HTMLElement;
        let hovered: HTMLElement | null = null;
        const isFrameElement = (value: EventTarget | Element | null): value is HTMLElement => (
          value instanceof FrameHTMLElement
        );
        const createOverlay = (color: string) => {
          const overlay = doc.createElement('div');
          overlay.setAttribute('aria-hidden', 'true');
          Object.assign(overlay.style, {
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: '2147483647',
            border: `2px solid ${color}`,
            boxSizing: 'border-box',
            display: 'none',
          });
          doc.body.appendChild(overlay);
          return overlay;
        };
        const rootStyle = getComputedStyle(document.documentElement);
        const tokenColor = (name: string) => rootStyle.getPropertyValue(name).trim() || '#128DDB';
        const hoverOverlay = createOverlay(tokenColor('--chart-4'));
        const selectedOverlay = createOverlay(tokenColor('--accent'));
        const positionOverlay = (overlay: HTMLDivElement, element: HTMLElement | null) => {
          if (!element || !element.isConnected) {
            overlay.style.display = 'none';
            return;
          }
          const rect = element.getBoundingClientRect();
          Object.assign(overlay.style, {
            display: 'block',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          });
        };
        const previousCursor = doc.documentElement.style.cursor;
        doc.documentElement.style.cursor = 'crosshair';
        const move = (event: MouseEvent) => {
          const element = isFrameElement(event.target) ? event.target : null;
          hovered = element;
          if (!selectedRef.current) selectionAnchorRef.current = element;
          positionOverlay(hoverOverlay, element === selectedRef.current ? null : element);
        };
        const click = (event: MouseEvent) => {
          event.preventDefault(); event.stopPropagation();
          if (isFrameElement(event.target)) {
            selectedRef.current = event.target;
            selectionAnchorRef.current = event.target;
            positionOverlay(selectedOverlay, event.target);
            positionOverlay(hoverOverlay, null);
            appendReference(event.target);
          }
        };
        const wheel = (event: WheelEvent) => {
          const current = selectedRef.current ?? hovered;
          if (!current) return;
          event.preventDefault();
          const anchor = selectionAnchorRef.current ?? current;
          selectionAnchorRef.current = anchor;
          const candidate = event.deltaY > 0
            ? current.parentElement && current.parentElement !== doc.documentElement ? current.parentElement : null
            : anchor && current !== anchor
              ? Array.from(current.children).find((child) => child.contains(anchor))
              : current.firstElementChild;
          const next = candidate ?? null;
          if (isFrameElement(next)) {
            if (selectedRef.current) {
              selectedRef.current = next;
              positionOverlay(selectedOverlay, next);
            } else {
              hovered = next;
              positionOverlay(hoverOverlay, next);
            }
          }
        };
        const reposition = () => {
          positionOverlay(hoverOverlay, hovered === selectedRef.current ? null : hovered);
          positionOverlay(selectedOverlay, selectedRef.current);
        };
        doc.addEventListener('mousemove', move, true);
        doc.addEventListener('click', click, true);
        frameWindow.addEventListener('wheel', wheel, { capture: true, passive: false });
        doc.addEventListener('scroll', reposition, true);
        frameWindow.addEventListener('resize', reposition);
        return () => {
          doc.removeEventListener('mousemove', move, true);
          doc.removeEventListener('click', click, true);
          frameWindow.removeEventListener('wheel', wheel, true);
          doc.removeEventListener('scroll', reposition, true);
          frameWindow.removeEventListener('resize', reposition);
          doc.documentElement.style.cursor = previousCursor;
          hoverOverlay.remove();
          selectedOverlay.remove();
        };
      } catch { toast.danger(t('workbench.inspectBlocked')); }
      return undefined;
    };
    // A cross-origin page leaves contentDocument null; say so instead of
    // leaving a picker that silently selects nothing. A detached frame (one
    // being replaced by a reload) is also null and is not a blocked page.
    const bindOrReportBlocked = () => {
      const unbind = bind();
      if (frame.isConnected && frame.contentDocument === null) {
        toast.danger(t('workbench.inspectBlocked'));
        setInspect(false);
      }
      return unbind;
    };
    let cleanup = bindOrReportBlocked();
    const handleLoad = () => {
      cleanup?.();
      selectedRef.current = null;
      selectionAnchorRef.current = null;
      cleanup = bindOrReportBlocked();
    };
    frame.addEventListener('load', handleLoad);
    return () => {
      frame.removeEventListener('load', handleLoad);
      cleanup?.();
    };
  }, [appendReference, frame, inspect]);

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(draft);
          }}
          className="min-w-0 flex-1"
        >
          <TextField aria-label={t('workbench.address')} className="w-full" value={draft} onChange={setDraft}>
            <Input placeholder="http://127.0.0.1:..." className="text-xs" />
          </TextField>
        </form>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={!url && !srcDoc}
            onPress={handleReload}
            aria-label={t('workbench.refreshPage')}
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiRefreshLine className="size-4" />
            </span>
            <span className="expandable-action-btn__label">{t('workbench.refresh')}</span>
          </Button>
          <Button
            size="sm"
            variant={inspect ? 'primary' : 'tertiary'}
            onPress={() => {
              setInspect((current) => {
                if (!current) {
                  selectedRef.current = null;
                  selectionAnchorRef.current = null;
                }
                return !current;
              });
            }}
            aria-label={inspect ? t('workbench.exitInspect') : t('workbench.selectElement')}
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiFocus3Line className="size-4" />
            </span>
            <span className="expandable-action-btn__label">{inspect ? t('workbench.exitInspect') : t('workbench.selectElement')}</span>
          </Button>
        </div>
      </div>
      {url || srcDoc ? (
        <div className="bg-surface min-h-0 flex-1 overflow-hidden rounded-xl border border-separator">
          <iframe ref={setFrame} title={t('workbench.webPreview')} src={url || undefined} srcDoc={srcDoc || undefined} className="size-full border-0" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
        </div>
      ) : (
        <div className="bg-surface-secondary flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl px-6 text-center">
          <RiGlobalLine className="text-muted size-6" />
          <p className="text-sm font-medium">{t('workbench.browserPreview')}</p>
          <p className="text-muted max-w-xs text-xs">{t('workbench.browserPreviewHint', { workspace: workspacePath || t('workbench.noWorkspace') })}</p>
          <Button size="sm" variant="secondary" onPress={() => navigateTo(draft || 'http://127.0.0.1:7345')}>
            {t('workbench.openDefault')}
          </Button>
        </div>
      )}
    </div>
  );
}

function GitDiffPane({ session }: { session: TodeXSession }) {
  const t = useT();
  const conversation = session.activeConversation;
  const state = conversation ? session.gitDiffByConversation[conversation.id] : undefined;
  const workspacePath = session.activeWorkspace?.path || '';
  const selectedRepoPath = (session.activeWorkspace && session.selectedGitRepoByWorkspace[session.activeWorkspace.id]) || workspacePath;
  const [pathDraft, setPathDraft] = useState(selectedRepoPath);
  useNoticeToast(state?.error !== session.lastError ? state?.error : null, { variant: 'danger', scope: conversation?.id });

  useEffect(() => {
    setPathDraft(selectedRepoPath);
  }, [selectedRepoPath]);

  const handleRefresh = () => {
    if (conversation) {
      void session.requestGitDiff(conversation.id, pathDraft);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRefresh();
          }}
          className="min-w-0 flex-1"
        >
          <TextField aria-label={t('workbench.gitPath')} className="w-full" value={pathDraft} onChange={setPathDraft}>
            <Input placeholder="/path/to/workspace..." className="text-xs" />
          </TextField>
        </form>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={!conversation || state?.status === 'loading'}
            onPress={handleRefresh}
            aria-label={t('workbench.refreshGitDiff')}
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiRefreshLine className={`size-4 ${state?.status === 'loading' ? 'animate-spin' : ''}`} />
            </span>
            <span className="expandable-action-btn__label">{t('workbench.refresh')}</span>
          </Button>
        </div>
      </div>
      <ScrollShadow className="bg-surface-secondary min-h-0 flex-1 rounded-xl p-3">
        <pre className={`font-mono text-xs whitespace-pre-wrap ${state?.error && !state?.diff ? 'text-danger' : ''}`}>
          {state?.diff || state?.error || t('aside.noDiff')}
        </pre>
      </ScrollShadow>
    </div>
  );
}

type FileTreeEntry = FileSourceEntry & {
  children?: FileTreeEntry[];
};

function findFileTreeEntry(entries: FileTreeEntry[], path: string): FileTreeEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const nested = entry.children ? findFileTreeEntry(entry.children, path) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

function replaceFileTreeChildren(entries: FileTreeEntry[], path: string, children: FileTreeEntry[]): FileTreeEntry[] {
  return entries.map((entry) => {
    if (entry.path === path) return { ...entry, children };
    return entry.children ? { ...entry, children: replaceFileTreeChildren(entry.children, path, children) } : entry;
  });
}

type FileOperationDialog =
  | { kind: 'mkdir'; directory: string }
  | { kind: 'rename'; path: string }
  | { kind: 'delete'; path: string; isDirectory: boolean };

function FilesPane({ session, target, onTargetChange, remote, onRemoteRebind }: {
  session: TodeXSession;
  target?: OpenPanelOptions;
  onTargetChange?: (target: OpenPanelOptions) => void;
  /** Bind the pane to a remote SFTP/FTP connection instead of the workspace. */
  remote?: RemoteFilesBinding;
  onRemoteRebind?: (remote: RemoteFilesBinding) => void;
}) {
  const t = useT();
  const targetChangeRef = useRef(onTargetChange);
  targetChangeRef.current = onTargetChange;
  const serverUrl = session.settings.serverUrl;
  const deviceSecret = session.settings.deviceSecret;
  const api = useCallback(() => new V2ApiClient({ serverUrl, device: deviceIdentityFromSecret(deviceSecret) }), [deviceSecret, serverUrl]);
  const workspacePath = session.activeWorkspace?.path || '';
  // shell.openPath/showItemInFolder act on the desktop's own filesystem, so
  // the menu only makes sense when the backend runs on this machine.
  const source: FileSource = useMemo(
    () => (remote ? remoteFileSource(api, remote) : workspaceFileSource(api, workspacePath, isLoopbackUrl(serverUrl))),
    [api, remote, serverUrl, workspacePath],
  );
  const remoteConnector = useRemoteConnector(api);
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [focused, setFocused] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Selection>(new Set());
  const [file, setFile] = useState<PreviewFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const fileRequestRef = useRef(0);
  const fileDirtyRef = useRef(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const treePanelRef = useRef<PanelImperativeHandle>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const appliedTargetRef = useRef<OpenPanelOptions | undefined>(undefined);
  const defaultPath = source.rootPath;
  const [currentPath, setCurrentPath] = useState(defaultPath);
  const [pathDraft, setPathDraft] = useState(defaultPath);
  const [operation, setOperation] = useState<FileOperationDialog | null>(null);
  const [operationName, setOperationName] = useState('');
  useNoticeToast(error, { variant: 'danger', scope: currentPath });

  useEffect(() => {
    setCurrentPath(source.rootPath);
    setPathDraft(source.rootPath);
  }, [source.key, source.rootPath]);

  const rootName = useMemo(() => {
    if (!currentPath) return remote ? remote.label : 'workspace';
    return currentPath.split(/[/\\]/).filter(Boolean).pop() || currentPath;
  }, [currentPath, remote]);

  const readFile = useCallback(async (path: string, sourceTarget?: OpenPanelOptions) => {
    if (fileDirtyRef.current && path !== selected && !window.confirm(t('filePreview.discardChanges'))) return;
    targetChangeRef.current?.(sourceTarget ?? { filePath: path });
    const request = ++fileRequestRef.current;
    setSelected(path);
    setFile(null);
    setFileLoading(true);
    setError('');
    try {
      const next = await source.read(path);
      if (request === fileRequestRef.current) setFile(next);
    } catch (reason) {
      if (request === fileRequestRef.current) setError(reason instanceof Error ? reason.message : t('workbench.fileReadFailed'));
    } finally {
      if (request === fileRequestRef.current) setFileLoading(false);
    }
  }, [selected, source, t]);

  const saveFile = useCallback(async (path: string, text: string, expectedText: string): Promise<WorkspaceFileSaveOutcome> => {
    try {
      const result = await source.save(path, text, expectedText);
      if (!result?.saved) {
        setError(t('workbench.fileSaveFailed'));
        return 'failed';
      }
      setFile((current) => (current && current.path === path ? { ...current, text, sizeBytes: new TextEncoder().encode(text).length } : current));
      return 'saved';
    } catch (reason) {
      if (isConflictError(reason)) return 'conflict';
      setError(reason instanceof Error ? reason.message : t('workbench.fileSaveFailed'));
      return 'failed';
    }
  }, [source, t]);

  const reloadFile = useCallback(async (path: string): Promise<PreviewFile | null> => {
    try {
      const latest = await source.read(path);
      setFile((current) => (current && current.path === path ? latest : current));
      return latest;
    } catch {
      return null;
    }
  }, [source]);

  useEffect(() => () => { fileRequestRef.current += 1; }, []);

  const addReferenceToChat = useCallback((selection: ReferenceSelection) => {
    const conversationId = session.activeConversation?.id;
    if (!conversationId || !file) {
      toast.danger(t('workbench.pickConversation'));
      return;
    }
    const baseName = file.name || file.path.split(/[\\/]/).pop() || file.path;
    const base = selection.lineStart
      ? `${baseName}:${selection.lineStart}${selection.lineEnd && selection.lineEnd !== selection.lineStart ? `-${selection.lineEnd}` : ''}`
      : t('workbench.excerpt', { name: baseName });
    const draft = session.chatDrafts[conversationId] ?? '';
    const name = uniqueReferenceName(base, session.composerAttachments[conversationId] ?? [], draft);
    session.setConversationAttachments(conversationId, (current) => [...current, {
      id: attachmentId(), kind: 'reference', name, mimeType: 'text/plain',
      sizeBytes: new TextEncoder().encode(selection.text).length, dataUrl: '',
      textContent: selection.text, source: 'preview', path: file.path,
      ...(selection.lineStart ? { lineStart: selection.lineStart, lineEnd: selection.lineEnd ?? selection.lineStart } : {}),
    }]);
    const token = referenceToken(name);
    session.setConversationChatDraft(conversationId, (current) => current ? `${current}\n${token}` : token);
    toast.success(t('workbench.referenceAdded', { name }));
  }, [file, session]);

  const loadDirectory = useCallback(async (directory: string, quiet = false): Promise<boolean> => {
    setLoading(true);
    if (!quiet) setError('');
    try {
      const children = await source.list(directory);
      setEntries((current) => directory === currentPath ? children : replaceFileTreeChildren(current, directory, children));
      setExpandedKeys((current) => new Set([...current, directory]));
      return true;
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : t('workbench.dirReadFailed'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [currentPath, source]);

  useEffect(() => {
    setEntries([]);
    setSelected('');
    setFocused('');
    setFile(null);
    setExpandedKeys(new Set());
    appliedTargetRef.current = undefined;
    fileRequestRef.current += 1;
    setFileLoading(false);
    if (currentPath) void loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const handleNavigatePath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    if (fileDirtyRef.current && !window.confirm(t('filePreview.discardChanges'))) {
      setPathDraft(currentPath);
      return;
    }
    setCurrentPath(trimmed);
  };

  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const canUseSystemShell = source.canUseSystemShell;
  const revealInManagerLabel = window.todexDesktop.shell.platform === 'darwin'
    ? t('workbench.revealInFinder')
    : window.todexDesktop.shell.platform === 'win32'
      ? t('workbench.revealInExplorer')
      : t('workbench.revealInFileManager');

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  useEffect(() => {
    if (!target?.filePath || target === appliedTargetRef.current) return;
    appliedTargetRef.current = target;
    void readFile(target.filePath, target);
  }, [readFile, target]);

  const handleAction = async (key: string) => {
    const entry = findFileTreeEntry(entries, key);
    if (!entry) return;
    if (entry.kind === 'directory' || entry.children) {
      if (!entry.children) await loadDirectory(entry.path);
      setExpandedKeys((current) => new Set([...current, entry.path]));
    } else if (entry.kind === 'symlink') {
      // A link may point at a directory or a file; listing tells them apart.
      if (!(await loadDirectory(entry.path, true))) await readFile(entry.path);
    } else {
      await readFile(entry.path);
    }
  };

  const openEntryContextMenu = (event: ReactMouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (findFileTreeEntry(entries, path)) void handleAction(path);
    else setSelected(path);
    setContextMenu({ path, x: event.clientX, y: event.clientY });
  };

  const runFileContextAction = async (action: 'open' | 'open-with' | 'reveal') => {
    const path = contextMenu?.path;
    setContextMenu(null);
    if (!path) return;
    try {
      if (action === 'open') await window.todexDesktop.shell.openPath(path);
      else if (action === 'open-with') await window.todexDesktop.shell.openWith(path);
      else await window.todexDesktop.shell.showItemInFolder(path);
    } catch (reason) {
      const message = reason instanceof Error
        ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        : '';
      toast.danger(message || t('workbench.openFailed'));
    }
  };

  // File operations act on the focused tree entry (the last one clicked,
  // directory or file); directories receive uploads and new folders.
  const hasFileOperations = Boolean(source.upload || source.download || source.mkdir || source.rename || source.remove);
  const focusedPath = focused || selected;
  const selectedEntry = focusedPath ? findFileTreeEntry(entries, focusedPath) : undefined;
  const selectedIsDirectory = focusedPath === currentPath || selectedEntry?.kind === 'directory' || Boolean(selectedEntry?.children);
  const targetDirectory = selectedIsDirectory && focusedPath ? focusedPath : selectedEntry ? source.parentPath(selectedEntry.path) : currentPath;
  const refreshDirectory = (directory: string) => loadDirectory(directory === currentPath || findFileTreeEntry(entries, directory) ? directory : currentPath);

  const runOperation = async (label: string, task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (reason) {
      toast.danger(t('ssh.files.operationFailed', { action: label, error: reason instanceof Error ? reason.message : String(reason) }));
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files: File[]) => {
    const upload = source.upload;
    if (!upload || !files.length) return;
    const directory = targetDirectory;
    await runOperation(t('ssh.files.upload'), async () => {
      for (const picked of files) {
        try {
          await upload(directory, picked, false);
        } catch (reason) {
          if (!isConflictError(reason) || !window.confirm(t('ssh.files.overwriteConfirm', { name: picked.name }))) throw reason;
          await upload(directory, picked, true);
        }
      }
      toast.success(t('ssh.files.uploaded', { count: files.length }));
      await refreshDirectory(directory);
    });
  };

  const submitOperation = async () => {
    const current = operation;
    if (!current) return;
    const name = operationName.trim();
    if (current.kind !== 'delete' && (!name || /[\\/]/.test(name))) {
      toast.danger(t('ssh.files.invalidName'));
      return;
    }
    setOperation(null);
    if (current.kind === 'mkdir' && source.mkdir) {
      const mkdir = source.mkdir;
      await runOperation(t('ssh.files.newFolder'), async () => {
        await mkdir(source.joinPath(current.directory, name));
        await refreshDirectory(current.directory);
      });
    } else if (current.kind === 'rename' && source.rename) {
      const rename = source.rename;
      const parent = source.parentPath(current.path);
      await runOperation(t('ssh.files.rename'), async () => {
        await rename(current.path, source.joinPath(parent, name));
        if (selected === current.path) { setSelected(''); setFile(null); }
        if (focused === current.path) setFocused('');
        await refreshDirectory(parent);
      });
    } else if (current.kind === 'delete' && source.remove) {
      const remove = source.remove;
      const parent = source.parentPath(current.path);
      await runOperation(t('ssh.files.delete'), async () => {
        await remove(current.path);
        if (selected === current.path) { setSelected(''); setFile(null); }
        if (focused === current.path) setFocused('');
        await refreshDirectory(parent);
      });
    }
  };

  const reconnectRemote = async () => {
    if (!remote) return;
    // FTP: try without a password first; the connector prompts on REMOTE_AUTH_FAILED.
    const connection = await remoteConnector.connect(remote.kind === 'sftp'
      ? { kind: 'sftp', host: remote.host ?? remote.label, label: remote.label }
      : { kind: 'ftp', siteId: remote.siteId ?? '', label: remote.label, askPassword: false });
    if (!connection) return;
    // The previous session is normally gone already; close it in case it is not.
    void api().closeRemoteConnection(remote.connectionId).catch(() => undefined);
    onRemoteRebind?.(remoteFilesBinding(connection));
  };

  const renderEntry = (entry: FileTreeEntry): ReactNode => (
    <FileTree.Item
      key={entry.path}
      icon={entry.kind === 'directory' || entry.children ? <RiFolder3Line /> : entry.kind === 'symlink' ? <RiLinksLine /> : <RiFileTextLine />}
      id={entry.path}
      textValue={entry.name}
      title={entry.name}
      onContextMenu={canUseSystemShell ? (event) => openEntryContextMenu(event, entry.path) : undefined}
    >
      {entry.children?.map(renderEntry)}
    </FileTree.Item>
  );

  const toggleTree = () => {
    if (treePanelRef.current?.isCollapsed()) treePanelRef.current.expand();
    else treePanelRef.current?.collapse();
  };

  const toolbarButton = (label: string, icon: ReactNode, onPress: () => void, isDisabled = false) => (
    <Tooltip delay={200}>
      <Button isIconOnly size="sm" variant="tertiary" aria-label={label} isDisabled={busy || isDisabled} onPress={onPress}>{icon}</Button>
      <Tooltip.Content className="text-xs">{label}</Tooltip.Content>
    </Tooltip>
  );
  const selectedRemovable = Boolean(selectedEntry);
  // Sources with file operations highlight the operation target, others the previewed file.
  const treeSelection = hasFileOperations ? focusedPath : selected;

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleNavigatePath(pathDraft);
          }}
          className="min-w-0 flex-1"
        >
          <TextField aria-label={t('workbench.pathLabel')} className="w-full" value={pathDraft} onChange={setPathDraft}>
            <Input placeholder="/path/to/directory..." className="text-xs" />
          </TextField>
        </form>
        <div className="flex shrink-0 items-center gap-2">
          {remote ? toolbarButton(t('ssh.files.reconnect'), <RiLink className="size-4" />, () => void reconnectRemote()) : null}
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={!currentPath || loading}
            onPress={() => currentPath && void loadDirectory(currentPath)}
            aria-label={t('workbench.refreshDir')}
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiRefreshLine className="size-4" />
            </span>
            <span className="expandable-action-btn__label">{t('workbench.refresh')}</span>
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            onPress={toggleTree}
            aria-label={treeCollapsed ? t('workbench.showTree') : t('workbench.collapseTree')}
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              {treeCollapsed ? <RiArrowRightDoubleLine className="size-4" /> : <RiArrowLeftDoubleLine className="size-4" />}
            </span>
            <span className="expandable-action-btn__label">{treeCollapsed ? t('workbench.expandTree') : t('workbench.collapseTree')}</span>
          </Button>
        </div>
      </div>
      {hasFileOperations ? (
        <div className="mb-3 flex items-center gap-1.5">
          {busy ? <Spinner size="sm" aria-label={t('ssh.files.working')} /> : null}
          {source.upload ? toolbarButton(t('ssh.files.upload'), <RiUpload2Line className="size-4" />, () => uploadInputRef.current?.click(), !currentPath) : null}
          {source.download ? toolbarButton(t('ssh.files.download'), <RiDownload2Line className="size-4" />, () => {
            const download = source.download;
            if (!download || !selectedEntry) return;
            void runOperation(t('ssh.files.download'), () => download(selectedEntry.path));
          }, !selectedEntry || selectedIsDirectory) : null}
          {source.mkdir ? toolbarButton(t('ssh.files.newFolder'), <RiFolderAddLine className="size-4" />, () => {
            setOperationName('');
            setOperation({ kind: 'mkdir', directory: targetDirectory });
          }, !currentPath) : null}
          {source.rename ? toolbarButton(t('ssh.files.rename'), <RiEdit2Line className="size-4" />, () => {
            if (!selectedEntry) return;
            setOperationName(selectedEntry.name);
            setOperation({ kind: 'rename', path: selectedEntry.path });
          }, !selectedRemovable) : null}
          {source.remove ? toolbarButton(t('ssh.files.delete'), <RiDeleteBinLine className="size-4" />, () => {
            if (!selectedEntry) return;
            setOperation({ kind: 'delete', path: selectedEntry.path, isDirectory: selectedIsDirectory });
          }, !selectedRemovable) : null}
          <span className="text-muted ml-1 min-w-0 truncate text-xs">{t('ssh.files.target', { path: targetDirectory || '/' })}</span>
          <input
            ref={uploadInputRef}
            className="hidden"
            type="file"
            multiple
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              // Reset so picking the same file again still fires onChange.
              event.target.value = '';
              void uploadFiles(picked);
            }}
          />
        </div>
      ) : null}
      <Resizable autoSaveId="todex.files-pane" className="min-h-0 flex-1 gap-3" onLayoutChange={() => setTreeCollapsed(Boolean(treePanelRef.current?.isCollapsed()))}>
        <Resizable.Panel
          id="file-tree"
          handleRef={treePanelRef}
          defaultSize="30%"
          minSize="18%"
          maxSize="50%"
          collapsedSize="0px"
          collapsible
          onCollapse={() => setTreeCollapsed(true)}
          onExpand={() => setTreeCollapsed(false)}
          className="min-h-0"
        >
          <ScrollShadow className="bg-surface-secondary h-full min-h-0 rounded-xl py-2 pl-1 pr-1.5">
          <FileTree
            key={`${source.key}:${currentPath || 'empty'}`}
            aria-label={remote ? t('ssh.files.treeLabel', { label: remote.label }) : t('workbench.workspaceFiles')}
            className="w-full workbench-file-tree"
            selectedKeys={treeSelection ? new Set([treeSelection]) : new Set()}
            expandedKeys={expandedKeys}
            selectionMode="single"
            selectionBehavior="replace"
            onSelectionChange={(keys: Selection) => {
              const key = keys === 'all' ? '' : String([...keys][0] ?? '');
              if (!key) return;
              if (hasFileOperations) setFocused(key);
              void handleAction(key);
            }}
            onExpandedChange={setExpandedKeys}
          >
            <FileTree.Item key={currentPath || 'root'} icon={<RiFolder3Line />} id={currentPath || 'root'} textValue={rootName} title={rootName} onContextMenu={canUseSystemShell && currentPath ? (event) => openEntryContextMenu(event, currentPath) : undefined}>
              {entries.map(renderEntry)}
            </FileTree.Item>
          </FileTree>
          </ScrollShadow>
        </Resizable.Panel>
        <Resizable.Handle type="pill" withIndicator aria-label={t('workbench.resizeTree')} />
        <Resizable.Panel defaultSize="70%" minSize="50%" className="min-h-0">
          <ScrollShadow className="bg-surface-secondary h-full min-h-0 rounded-xl p-3">
            <p className="text-muted mb-2 truncate text-xs">{selected || t('workbench.selectFile')}</p>
            {fileLoading ? <Spinner size="sm" aria-label={t('workbench.readingFile')} /> : error ? null : <WorkspaceFilePreview file={file} onAddReference={source.canAddReference ? addReferenceToChat : undefined} onSaveFile={saveFile} onReloadFile={reloadFile} onDirtyChange={(dirty) => { fileDirtyRef.current = dirty; }} />}
          </ScrollShadow>
        </Resizable.Panel>
      </Resizable>
      {contextMenu ? (
        <HeroContextMenu open onOpenChange={(open) => { if (!open) setContextMenu(null); }}>
          <div
            className="fixed z-50 w-44 rounded-xl border border-separator bg-overlay p-1 shadow-overlay"
            style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 184)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 140)) }}
            onClick={(event) => event.stopPropagation()}
          >
            <HeroContextMenu.Menu aria-label={t('workbench.fileMenu')} autoFocus="first" onClose={() => setContextMenu(null)}>
              <HeroContextMenu.Item id="open" textValue={t('workbench.open')} onAction={() => void runFileContextAction('open')}><RiExternalLinkLine className="size-4 text-muted" /><Label>{t('workbench.open')}</Label></HeroContextMenu.Item>
              <HeroContextMenu.Item id="open-with" textValue={t('workbench.openWith')} onAction={() => void runFileContextAction('open-with')}><RiAppsLine className="size-4 text-muted" /><Label>{t('workbench.openWith')}</Label></HeroContextMenu.Item>
              <HeroContextMenu.Separator />
              <HeroContextMenu.Item id="reveal" textValue={revealInManagerLabel} onAction={() => void runFileContextAction('reveal')}><RiFolderOpenLine className="size-4 text-muted" /><Label>{revealInManagerLabel}</Label></HeroContextMenu.Item>
            </HeroContextMenu.Menu>
          </div>
        </HeroContextMenu>
      ) : null}
      <Modal isOpen={operation?.kind === 'mkdir' || operation?.kind === 'rename'} onOpenChange={(open) => { if (!open) setOperation(null); }}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-sm">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{operation?.kind === 'rename' ? t('ssh.files.rename') : t('ssh.files.newFolder')}</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <form id="file-operation-form" onSubmit={(event) => { event.preventDefault(); void submitOperation(); }}>
                  <TextField className="w-full" value={operationName} onChange={setOperationName} autoFocus>
                    <Label>{t('ssh.files.name')}</Label>
                    <Input className="w-full" />
                  </TextField>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
                <Button type="submit" form="file-operation-form">{t('common.save')}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <AlertDialog isOpen={operation?.kind === 'delete'} onOpenChange={(open) => { if (!open) setOperation(null); }}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-md">
              <AlertDialog.Header>
                <AlertDialog.Heading>{t('ssh.files.deleteTitle')}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-muted break-all text-sm">
                  {operation?.kind === 'delete' ? t(operation.isDirectory ? 'ssh.files.deleteDirectoryBody' : 'ssh.files.deleteFileBody', { path: operation.path }) : null}
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">{t('common.cancel')}</Button>
                <Button variant="danger" onPress={() => void submitOperation()}>{t('common.delete')}</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
      {remoteConnector.dialog}
    </div>
  );
}

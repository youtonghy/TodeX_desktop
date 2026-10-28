import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentType, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react';
import { RiAppsLine, RiCloseLine, RiDeleteBinLine, RiDownload2Line, RiEdit2Line, RiFolderAddLine, RiLinksLine, RiLink, RiServerLine, RiTerminalBoxLine, RiTerminalWindowLine, RiUpload2Line, RiGitBranchLine, RiAddLine, RiArrowLeftDoubleLine, RiArrowRightDoubleLine, RiExternalLinkLine, RiBracesLine, RiFileCodeLine, RiFileLine, RiFilePdf2Line, RiFileSettingsLine, RiFileTextLine, RiFileZipLine, RiImageLine, RiLockLine, RiMarkdownLine, RiFolder3Line, RiFolderOpenLine, RiGlobalLine, RiLayoutColumnLine, RiLayoutRowLine, RiRefreshLine, RiRobot2Line, RiStopCircleLine, RiTeamLine } from '@remixicon/react';
import { Focusable, Pressable } from 'react-aria-components';
import type { Key, Selection } from 'react-aria-components';
import { Badge } from '@/components/base/badges/badge';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { PillTabList } from '@/components/base/tabs/pill-tab';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { TreeView, TreeViewItem } from '@/components/base/tree-view/tree-view';
import { IconAction } from '@/components/ui/icon-action';
import { ContextMenu, Menu, MenuItem, MenuPopover, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { Resizable, type PanelImperativeHandle } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { WorkspaceFilePreview, type PreviewFile, type ReferenceSelection, type WorkspaceFileSaveOutcome } from '../components/WorkspaceFilePreview';
import { useNoticeToast } from '../components/NoticeToast';
import { GitDiffText } from '../components/GitDiffText';
import { XtermTerminal, type XtermTerminalHandlers } from '../components/XtermTerminal';
import { SshExecPane } from '../components/ssh/SshExecPane';
import { AgentBrowserLiveView } from '../components/AgentBrowserLiveView';
import { ExpandableAction } from '../components/ExpandableAction';
import { rememberSessionSshExecTabs, sessionSshExecTabsFor, useSshExecClear, visibleSshExecs } from '../session/sshExecTabs';
import type { TodeXSession } from '../session/useTodeXSession';
import { useRemoteConnector } from '../components/ssh/useRemoteConnector';
import { normalizeRemoteFilesBinding, remoteFileSource, remoteFilesBinding, workspaceFileSource, type FileSource, type FileSourceEntry, type RemoteFilesBinding, sortFileEntries } from '../session/fileSources';
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  latencyLabelOf,
  terminalIdForConversation,
  terminalStatusLabel,
  type TerminalTarget,
} from '../session/helpers';
import { isSystemWorkbenchTab, type OpenPanelOptions, type WorkbenchItem, type WorkbenchRequest, type WorkbenchTab } from '../lib/panels';
import { ShortcutHint, useAppShortcuts, workbenchTabShortcut, type ShortcutId } from '../lib/shortcuts';
import { normalizeWorkbenchLayout } from '../session/workbenchLayout';
import { SETTINGS_STORAGE_KEY, attachmentId, backendApi, referenceToken, uniqueReferenceName } from '../session/helpers';
import { isConflictError } from '@todex/protocol/connectionError';
import { isNotFoundError, type SshExecRun } from '@todex/protocol/ssh';
import type { SubagentRun } from '@todex/protocol/v2';
import { SubagentsPanel } from './SubagentsPanel';
import { AgentCallsPanel } from './AgentCallsPanel';
import { isActiveAgentCallStatus, type AgentCallSession } from '@todex/protocol/agentCalling';
import { isLocalBackendUrl } from '@todex/protocol/mobileParity';
import { mapBackendPathToHost } from '@todex/protocol/pathMapping';
import { systemShellPathResolver } from '../session/hostPaths';
import { resolveTerminalPath } from '@todex/protocol/terminalText';
import { patchTerminalActivity, forgetTerminalActivity, terminalActivity, useTerminalActivity } from '../session/terminalActivity';
import { postCompletionNotification } from '../session/completionNotifications';
import { uploadTerminalImages } from '../session/terminalImagePaste';
import { t, useT, type MessageKey } from '../i18n';
import { platform } from '../platform';
import { slots } from '../platform/slots';

type Props = {
  scopeKey?: string;
  /** The panel is on screen (the aside is open); live views pause while it is not. */
  shown?: boolean;
  onTargetConsumed?: () => void;
  session: TodeXSession;
  tab: WorkbenchTab;
  target?: OpenPanelOptions;
  onTabChange: (tab: WorkbenchTab) => void;
  closeRequestRef?: RefObject<() => boolean>;
  /** SSH view scope: tabs are opened from the SSH view, not the + menu. */
  sshMode?: boolean;
  /** Backend the SSH terminals and remote file tabs run on (default: the
   * focused backend). */
  sshBackendId?: string;
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

/** Types written to the tab store; 'ssh-exec', 'subagents', 'agent-calls' and 'agent-browser' tabs are session-only. */
const WORKBENCH_TYPES = new Set<WorkbenchTab>(['terminal', ...(slots.BrowserPane ? ['browser' as const] : []), 'files', 'git-diff']);

const WORKBENCH_LABEL_KEYS: Record<WorkbenchTab, MessageKey> = {
  terminal: 'workbench.tabTerminal',
  browser: 'workbench.tabBrowser',
  files: 'workbench.tabFiles',
  'git-diff': 'workbench.tabGitDiff',
  'ssh-exec': 'workbench.tabSshExec',
  subagents: 'app.subagents',
  'agent-calls': 'agentCalls.title',
  'agent-browser': 'agentBrowser.title',
};

const workbenchLabel = (tab: WorkbenchTab) => t(WORKBENCH_LABEL_KEYS[tab]);

const WORKBENCH_ICONS = {
  terminal: RiTerminalBoxLine,
  browser: RiGlobalLine,
  files: RiFileTextLine,
  'git-diff': RiGitBranchLine,
  'ssh-exec': RiTerminalWindowLine,
  subagents: RiRobot2Line,
  'agent-calls': RiTeamLine,
  'agent-browser': RiGlobalLine,
};

const REMOTE_ICONS = {
  terminal: RiServerLine,
  files: RiFolder3Line,
};

type WorkbenchTabAxis = 'horizontal' | 'vertical';

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

const WORKBENCH_TAB_AXIS_KEY = `${SETTINGS_STORAGE_KEY}.workbenchTabAxis.v1`;

/** `sessionItems` are this app session's session-only tabs for the scope; they
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
  return backendApi(session.settings);
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

export function WorkbenchPanel({ session, tab, target, onTabChange, scopeKey = session.activeConversation?.id || '', shown = true, onTargetConsumed, closeRequestRef, sshMode = false, sshBackendId: sshBackendProp, requests, onRequestsHandled, onItemsChange }: Props) {
  const t = useT();
  const { BrowserPane } = slots;
  const storageKey = `${SETTINGS_STORAGE_KEY}.workbenchTabs.v1:${scopeKey}`;
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [restored, setRestored] = useState(false);
  const [axis, setAxis] = useState<WorkbenchTabAxis>('vertical');
  const sshBackendId = sshBackendProp || session.activeBackendConnectionId;
  const sshSettings = session.settingsForBackend(sshBackendId);
  const requestedTargetRef = useRef(target);
  const openedTargetRef = useRef<{ target: OpenPanelOptions; tab: WorkbenchTab } | null>(null);
  requestedTargetRef.current = target;

  useEffect(() => {
    let cancelled = false;
    void platform.store.get(storageKey)
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
    const persisted = items.filter(item => WORKBENCH_TYPES.has(item.type)).map(normalizeWorkbenchItem);
    void platform.store.set(storageKey, { items: persisted, activeId } satisfies StoredWorkbenchState)
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
  // tab closes its backend connection. Agent SSH, Subagents and Agent calls tabs stay.
  const [confirmCloseId, setConfirmCloseId] = useState('');
  const closeTab = useCallback((id: string, confirmed = false) => {
    const item = items.find((entry) => entry.id === id);
    if (item && isSystemWorkbenchTab(item.type)) return;
    // Shell integration knows when a command is still running: ask first.
    if (!confirmed && item?.type === 'terminal' && terminalActivity(terminalIdForConversation(scopeKey, id)).commandRunning) {
      setConfirmCloseId(id);
      return;
    }
    if (item?.type === 'terminal') forgetTerminalActivity(terminalIdForConversation(scopeKey, id));
    const terminal = item?.type === 'terminal' ? session.terminalById[terminalIdForConversation(scopeKey, id)] : undefined;
    if (item && terminal && (terminal.status === 'running' || terminal.status === 'starting' || terminal.status === 'stopping')) {
      session.stopTerminalSession(terminalIdForConversation(scopeKey, id), item.ssh ? sshSettings.tenantId : session.activeWorkspace?.tenantId || session.settings.tenantId);
    }
    if (item?.remote) {
      const { connectionId, label } = item.remote;
      void backendApi(sshSettings).closeRemoteConnection(connectionId).catch((reason) => {
        // Already dropped by the backend (idle timeout or restart) is fine.
        if (isNotFoundError(reason)) return;
        toast.danger(t('ssh.remote.closeFailed', { label, error: reason instanceof Error ? reason.message : String(reason) }));
      });
    }
    removeTab(id);
  }, [items, removeTab, scopeKey, session, sshSettings, t]);

  const updateRemoteBinding = useCallback((id: string, remote: RemoteFilesBinding) => {
    setItems(current => current.map(item => item.id === id ? { ...item, remote, title: remote.label } : item));
  }, []);

  useEffect(() => { onItemsChange?.(items); }, [items, onItemsChange]);

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
      if (request.kind === 'agent-browser') {
        const existing = [...items, ...added].find(item => item.agentBrowser?.conversationId === request.conversationId);
        if (existing) {
          opened = existing;
          continue;
        }
        const item: WorkbenchItem = { id: `agent-browser-${Date.now()}-${request.id}`, type: 'agent-browser', title: t('agentBrowser.title'), agentBrowser: { conversationId: request.conversationId } };
        added.push(item);
        opened = item;
        continue;
      }
      if (request.kind === 'browser') {
        const count = [...items, ...added].filter(item => item.type === 'browser').length + 1;
        const item: WorkbenchItem = { id: `browser-${Date.now()}-${request.id}`, type: 'browser', title: `${workbenchLabel('browser')} ${count}`, target: { url: request.url } };
        added.push(item);
        opened = item;
        continue;
      }
      if (request.kind === 'ssh-exec' || request.kind === 'subagents' || request.kind === 'agent-calls') {
        // One tab per conversation and kind: reuse it, or create it.
        const { kind, conversationId } = request;
        const existing = [...items, ...added].find(item => (kind === 'ssh-exec' ? item.sshExec : kind === 'subagents' ? item.subagents : item.agentCalls)?.conversationId === conversationId);
        if (existing) {
          opened = existing;
          continue;
        }
        const item: WorkbenchItem = { id: `${kind}-${Date.now()}-${request.id}`, type: kind, title: workbenchLabel(kind), ...(kind === 'ssh-exec' ? { sshExec: { conversationId } } : kind === 'subagents' ? { subagents: { conversationId } } : { agentCalls: { conversationId } }) };
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
    if (added.length) setItems(current => [...current, ...added]);
    if (opened) {
      setActiveId(opened.id);
      onTabChange(opened.type);
    }
  }, [closeTab, items, onRequestsHandled, onTabChange, requests, restored, t]);

  // The shortcut is consumed on an Agent SSH, Subagents or Agent calls tab (which stays),
  // rather than falling back to closing the window.
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
    void platform.store.get(WORKBENCH_TAB_AXIS_KEY)
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
    void platform.store.set(WORKBENCH_TAB_AXIS_KEY, next)
      .catch((reason) => {
        console.error('Failed to persist workbench tab axis', reason);
      });
  };

  const selectTab = (item: WorkbenchItem) => {
    setActiveId(item.id);
    onTabChange(item.type);
  };
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const shortcutHandlers: Partial<Record<ShortcutId, () => void>> = {};
  if (shown) {
    items.forEach((item, index) => {
      const id = workbenchTabShortcut(index);
      if (id) shortcutHandlers[id] = () => selectTab(item);
    });
    if (!sshMode && restored) shortcutHandlers.newWorkbenchTab = () => setNewTabMenuOpen(true);
  }
  useAppShortcuts(shortcutHandlers);

  const tabStrip = items.map((item, index) => {
    const tabShortcut = workbenchTabShortcut(index);
    const Icon = item.ssh || item.remote ? REMOTE_ICONS[item.type === 'terminal' ? 'terminal' : 'files'] : WORKBENCH_ICONS[item.type];
    const workspacePath = session.activeWorkspace?.path;
    const location = isSystemWorkbenchTab(item.type)
      ? ''
      : item.type === 'agent-browser'
      ? [...(session.conversationRuntimeById[item.agentBrowser?.conversationId ?? '']?.desktopBrowser.actions ?? [])].reverse().find(action => action.url)?.url || ''
      : item.ssh
      ? `ssh ${item.ssh.host}`
      : item.remote
        ? `${item.remote.label}${item.target?.filePath ? ` ${item.target.filePath}` : ''}`
        : item.type === 'terminal'
          ? session.terminalById[terminalIdForConversation(scopeKey, item.id)]?.cwd || workspacePath
          : item.type === 'browser'
            ? item.target?.url || item.target?.filePath || ''
            : item.target?.filePath || workspacePath;
    const title = isSystemWorkbenchTab(item.type) ? workbenchLabel(item.type) : location ? `${workbenchLabel(item.type)} ${location}` : item.title;
    const isActive = item.id === activeId;
    const closable = !isSystemWorkbenchTab(item.type);
    const tabIconClass = cx('size-4 transition-opacity duration-150', closable && isActive && 'group-hover/tab:opacity-0 group-focus-within/tab:opacity-0 [@media(hover:none)]:opacity-0');
    return (
      <div
        key={item.id}
        // The pill list slides its selection background under this slot.
        data-pill-selected={isActive ? '' : undefined}
        data-pill-variant="blue"
        className="group/tab relative z-10 flex size-9 shrink-0 items-center justify-center"
      >
        <TooltipTrigger delay={200}>
          <Focusable>
            <button
              type="button" aria-label={title} aria-pressed={isActive}
              className={cx(
                'flex size-9 cursor-pointer items-center justify-center rounded-full outline-none',
                'transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                isActive ? 'text-accent-500' : 'text-foreground-icon-secondary hover:bg-pill-tab-blue-hover-background hover:text-foreground-icon-primary',
              )}
              onClick={() => selectTab(item)}
            >
              {item.sshExec ? (
                <SshExecTabIcon conversationId={item.sshExec.conversationId} runs={session.conversationRuntimeById[item.sshExec.conversationId]?.sshExecs} className={tabIconClass} />
              ) : item.subagents ? (
                <SubagentsTabIcon runs={session.subagentsByConversation[item.subagents.conversationId]} className={tabIconClass} />
              ) : item.agentCalls ? (
                <AgentCallsTabIcon calls={session.agentCallsByConversation[item.agentCalls.conversationId]} className={tabIconClass} />
              ) : item.type === 'terminal' ? (
                <TerminalTabIcon terminalId={terminalIdForConversation(scopeKey, item.id)} icon={Icon} className={tabIconClass} />
              ) : <Icon aria-hidden="true" className={tabIconClass} />}
            </button>
          </Focusable>
          <Tooltip placement={vertical ? 'right' : 'bottom'} className="max-w-sm break-all">
            {item.type === 'terminal' ? <TerminalTabTitle terminalId={terminalIdForConversation(scopeKey, item.id)} fallback={title} /> : title}
          </Tooltip>
        </TooltipTrigger>
        {tabShortcut ? <ShortcutHint id={tabShortcut} compact className="absolute -top-1 -end-1 z-20" /> : null}
        {closable ? (
          <IconAction
            icon={RiCloseLine} size="xs" aria-label={t('workbench.closeTab', { title })}
            className={cx(
              'pointer-events-none absolute inset-0 m-auto rounded-full opacity-0 transition-[opacity,background-color,color]',
              isActive && 'group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
            )}
            onClick={() => closeTab(item.id)}
          />
        ) : null}
      </div>
    );
  });

  const newTabDropdown = (
    <MenuTrigger isOpen={newTabMenuOpen} onOpenChange={setNewTabMenuOpen}>
      <span className="relative inline-flex shrink-0">
        <Pressable isDisabled={!restored}>
          <IconAction icon={RiAddLine} aria-label={t('workbench.newTab')} disabled={!restored} />
        </Pressable>
        <ShortcutHint id="newWorkbenchTab" compact className="absolute -top-1 -end-1 z-20" />
      </span>
      <MenuPopover placement={vertical ? 'right top' : 'bottom end'}>
        <Menu aria-label={t('workbench.newTab')} onAction={(key) => addTab(String(key) as WorkbenchTab)}>
          <MenuItem id="terminal" icon={WORKBENCH_ICONS.terminal} textValue={t('workbench.tabTerminal')}>{t('workbench.tabTerminal')}</MenuItem>
          {slots.BrowserPane ? <MenuItem id="browser" icon={WORKBENCH_ICONS.browser} textValue={t('workbench.tabBrowser')}>{t('workbench.tabBrowser')}</MenuItem> : null}
          <MenuItem id="files" icon={WORKBENCH_ICONS.files} textValue={t('workbench.tabFiles')}>{t('workbench.tabFiles')}</MenuItem>
          <MenuItem id="git-diff" icon={WORKBENCH_ICONS['git-diff']} textValue="Git Diff">Git Diff</MenuItem>
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );

  const axisToggle = (
    <IconAction
      icon={vertical ? RiLayoutRowLine : RiLayoutColumnLine}
      aria-label={axisLabel}
      tooltip
      tooltipPlacement={vertical ? 'right' : 'bottom'}
      onClick={toggleAxis}
    />
  );

  // Remounts when nothing is selected so the sliding pill does not linger.
  const tabList = items.length ? (
    <PillTabList key={active ? 'tabs' : 'none'} className={vertical ? 'flex-col gap-0.5' : 'gap-1'}>
      {tabStrip}
    </PillTabList>
  ) : null;

  return (
    <div className={cx('flex h-full min-h-0', !vertical && 'flex-col')}>
      <div className={vertical
        ? 'flex w-11 shrink-0 flex-col border-e border-separator-border'
        : 'flex min-h-11 shrink-0 items-center gap-1 border-b border-separator-border px-2'}
      >
        {vertical ? (
          <ScrollArea className="min-h-0 flex-1" contentClassName="flex flex-col items-center gap-0.5 py-1" surface="secondary">
            {tabList}
            {sshMode ? null : newTabDropdown}
          </ScrollArea>
        ) : (
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto py-1">{tabList}</div>
        )}
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
          <div className="flex h-full items-center justify-center px-6 text-center text-body-medium text-text-tertiary">{sshMode ? t('ssh.workbenchEmpty') : t('workbench.noTabs')}</div>
        ) : null}
        {items.map((item) => (
          <div key={item.id} className={item.id === active?.id ? 'h-full' : 'hidden'}>
            {item.type === 'terminal' ? (
              <TerminalPane
                isActive={item.id === active?.id}
                shown={shown}
                session={session}
                terminalId={terminalIdForConversation(scopeKey, item.id)}
                workspaceTarget={workspaceTerminalTarget}
                sshHost={item.ssh?.host}
                sshBackendId={sshBackendId}
                autoConnect={!item.ssh || freshSshTabsRef.current.has(item.id)}
              />
            ) : null}
            {item.type === 'browser' && BrowserPane ? <BrowserPane itemId={item.id} isActive={item.id === active?.id} workspacePath={session.activeWorkspace?.path} session={session} target={item.type === tab && item.id === active?.id && (target?.filePath || target?.url) ? target : item.target} onTargetChange={next => updateTabTarget(item.id, next)} /> : null}
            {item.type === 'files' ? <FilesPane session={session} remote={item.remote} remoteBackendId={sshBackendId} onRemoteRebind={next => updateRemoteBinding(item.id, next)} target={item.type === tab && item.id === active?.id && (target?.filePath || target?.url) ? target : item.target} onTargetChange={next => updateTabTarget(item.id, next)} /> : null}
            {item.type === 'git-diff' ? <GitDiffPane session={session} /> : null}
            {item.type === 'ssh-exec' && item.sshExec ? <SshExecPane conversationId={item.sshExec.conversationId} runs={session.conversationRuntimeById[item.sshExec.conversationId]?.sshExecs ?? NO_SSH_EXECS} isActive={item.id === active?.id} /> : null}
            {item.type === 'subagents' && item.subagents ? <SubagentsPanel session={session} conversationId={item.subagents.conversationId} /> : null}
            {item.type === 'agent-calls' && item.agentCalls ? <AgentCallsPanel session={session} conversationId={item.agentCalls.conversationId} /> : null}
            {item.type === 'agent-browser' && item.agentBrowser ? <AgentBrowserLiveView session={session} isActive={shown && item.id === active?.id} conversationId={item.agentBrowser.conversationId} /> : null}
          </div>
        ))}
      </div>
      <ConfirmDialog
        isOpen={Boolean(confirmCloseId)}
        onOpenChange={(open) => { if (!open) setConfirmCloseId(''); }}
        title={t('xterm.closeRunningTitle')}
        description={t('xterm.closeRunningDescription')}
        confirmLabel={t('xterm.closeRunningConfirm')}
        cancelLabel={t('xterm.cancel')}
        tone="danger"
        onConfirm={() => {
          const id = confirmCloseId;
          setConfirmCloseId('');
          if (id) closeTab(id, true);
        }}
      />
    </div>
  );
}

const NO_SSH_EXECS: SshExecRun[] = [];

/** The Agent SSH tab icon carries the number of calls in its log view. */
function SshExecTabIcon({ conversationId, runs = NO_SSH_EXECS, className }: { conversationId: string; runs?: SshExecRun[]; className: string }) {
  const clear = useSshExecClear(conversationId);
  const count = useMemo(() => visibleSshExecs(runs, clear).length, [clear, runs]);
  return (
    <span className={cx('relative inline-flex', className)}>
      <RiTerminalWindowLine aria-hidden="true" className="size-4" />
      {count ? (
        <Badge color="primary" className="absolute -end-2.5 -top-2 min-w-4 px-0.5 text-caption-2-semibold tabular-nums">
          {count > 99 ? '99+' : count}
        </Badge>
      ) : null}
    </span>
  );
}

const NO_SUBAGENTS: SubagentRun[] = [];

const NO_AGENT_CALLS: AgentCallSession[] = [];

/** The Agent calls tab icon carries the number of running calls. */
function AgentCallsTabIcon({ calls = NO_AGENT_CALLS, className }: { calls?: AgentCallSession[]; className: string }) {
  const count = calls.filter(call => isActiveAgentCallStatus(call.status)).length;
  return (
    <span className={cx('relative inline-flex', className)}>
      <RiTeamLine aria-hidden="true" className="size-4" />
      {count ? (
        <Badge color="primary" className="absolute -end-2.5 -top-2 min-w-4 px-0.5 text-caption-2-semibold tabular-nums">
          {count > 99 ? '99+' : count}
        </Badge>
      ) : null}
    </span>
  );
}

/** The Subagents tab icon carries the number of queued or running subagents. */
function SubagentsTabIcon({ runs = NO_SUBAGENTS, className }: { runs?: SubagentRun[]; className: string }) {
  const count = runs.filter(run => run.status === 'running' || run.status === 'queued').length;
  return (
    <span className={cx('relative inline-flex', className)}>
      <RiRobot2Line aria-hidden="true" className="size-4" />
      {count ? (
        <Badge color="primary" className="absolute -end-2.5 -top-2 min-w-4 px-0.5 text-caption-2-semibold tabular-nums">
          {count > 99 ? '99+' : count}
        </Badge>
      ) : null}
    </span>
  );
}

/** A terminal tab's icon, with a dot while output arrives or when a command
 * finished out of sight. */
function TerminalTabIcon({ terminalId, icon: Icon, className }: { terminalId: string; icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>; className: string }) {
  const activity = useTerminalActivity(terminalId);
  const dot = activity.attention ? 'bg-accent-500' : activity.printing ? 'bg-state-success-base' : '';
  return (
    <span className={cx('relative inline-flex', className)}>
      <Icon aria-hidden="true" className="size-4" />
      {dot ? <span aria-hidden className={cx('absolute -end-1 -top-1 size-2 rounded-full ring-2 ring-background-primary-default', dot)} /> : null}
    </span>
  );
}

/** A terminal tab's tooltip: the title the shell or program set, else `fallback`. */
function TerminalTabTitle({ terminalId, fallback }: { terminalId: string; fallback: string }) {
  const activity = useTerminalActivity(terminalId);
  return <>{activity.title ? `${activity.title} — ${fallback}` : fallback}</>;
}

/** How long opening a terminal waits for its view to report a size. */
const VIEW_SIZE_WAIT_MS = 400;
/** Commands this long that finish out of sight post a notification. */
const COMMAND_NOTIFY_MS = 10_000;
/** A terminal shows its "printing" dot this long after output. */
const PRINTING_MS = 1500;
/** At most one program notification per terminal in this window. */
const PROGRAM_NOTIFY_INTERVAL_MS = 5000;

function TerminalPane({ session, terminalId, isActive, shown, workspaceTarget, sshHost, sshBackendId = '', autoConnect = true }: {
  session: TodeXSession;
  terminalId: string;
  isActive: boolean;
  /** The Workbench is on screen. */
  shown: boolean;
  workspaceTarget: TerminalTarget | null;
  /** Set for SSH tabs: the terminal runs `ssh -tt <host>` on the backend. */
  sshHost?: string;
  /** Backend an SSH tab runs on. */
  sshBackendId?: string;
  /** False for restored SSH tabs: they reattach to a live session but only
   * start `ssh` (and its password/host-key prompts) on an explicit Connect. */
  autoConnect?: boolean;
}) {
  const t = useT();
  const target = useMemo<TerminalTarget | null>(
    () => (sshHost ? { kind: 'ssh', host: sshHost, backendConnectionId: sshBackendId } : workspaceTarget),
    [sshBackendId, sshHost, workspaceTarget],
  );
  const workspace = target?.kind === 'workspace' ? target.workspace : null;
  const isSsh = target?.kind === 'ssh';
  const targetKey = !target ? '' : target.kind === 'ssh' ? `ssh:${target.host}` : target.conversation.id;
  const tenantId = workspace?.tenantId || (isSsh ? session.settingsForBackend(sshBackendId).tenantId : session.settings.tenantId);
  const backendIdentity = (isSsh ? sshBackendId : workspace?.backendConnectionId) || session.activeBackendConnectionId || session.settings.serverUrl;
  // An SSH tab follows its own backend's connection, not the focused one's.
  const connectionState = isSsh ? session.backendLinkStatus[sshBackendId]?.state ?? 'idle' : session.connectionState;
  const autoStartAttempts = useRef(new Set<string>());
  const manualStopRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const terminalByIdRef = useRef(session.terminalById);
  const terminalSizeRef = useRef({ rows: DEFAULT_TERMINAL_ROWS, cols: DEFAULT_TERMINAL_COLS });
  const terminal = terminalId ? session.terminalById[terminalId] : undefined;
  const stream = session.terminalStreams.get(terminalId);
  /** The shell's directory as it reports it (OSC 7). */
  const liveCwdRef = useRef('');

  terminalByIdRef.current = session.terminalById;

  useEffect(() => {
    autoStartAttempts.current.clear();
    manualStopRef.current = false;
    reconnectAttemptRef.current = 0;
    liveCwdRef.current = '';
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [terminalId, backendIdentity]);

  /** The size the view last reported; null until it has been laid out. */
  const viewSizeRef = useRef<{ rows: number; cols: number } | null>(null);

  useEffect(() => {
    if (!terminal) return;
    // Until the view reports its size, starts use the PTY's last size.
    if (!viewSizeRef.current) terminalSizeRef.current = { rows: terminal.rows, cols: terminal.cols };
  }, [terminal?.cols, terminal?.rows]);

  // The view's size may arrive while the terminal is still starting (the
  // resize is dropped then): once it runs, bring the PTY to the view's size.
  // Only on that transition, so two windows never undo each other's size.
  useEffect(() => {
    const view = viewSizeRef.current;
    const current = terminalByIdRef.current[terminalId];
    if (terminal?.status !== 'running' || !current || !view) return;
    if (current.rows === view.rows && current.cols === view.cols) return;
    session.resizeTerminalSession(terminalId, tenantId, view.rows, view.cols);
  }, [terminal?.status, terminalId, tenantId, session.resizeTerminalSession]);

  // Opening waits for the view's size (or a moment, for a hidden tab), so
  // the PTY and its snapshot already have the size the view shows.
  const [viewReady, setViewReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setViewReady(true), VIEW_SIZE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Joins the terminal when the backend still runs it (after a reload, or
  // from another window), otherwise starts it.
  useEffect(() => {
    if (!target || !terminalId || connectionState !== 'open' || !viewReady) {
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
    const size = terminalSizeRef.current;
    session.openTerminalSession(target, {
      terminalId,
      cwd: workspace?.path ?? '',
      shell: '',
      rows: size.rows,
      cols: size.cols,
      autoStart: !isSsh || autoConnect,
    });
  }, [
    autoConnect,
    isSsh,
    targetKey,
    connectionState,
    viewReady,
    session.openTerminalSession,
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
    if (!target || isSsh || !terminalId || connectionState !== 'open' || manualStopRef.current) {
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
      if (manualStopRef.current) {
        return;
      }
      const latest = terminalByIdRef.current[terminalId];
      if (latest?.stopRequested) {
        return;
      }
      // Joins rather than restarts when another client already brought a
      // shell back under this id; restarting would spawn a duplicate.
      const size = terminalSizeRef.current;
      session.openTerminalSession(target, {
        terminalId,
        // The shell's own start directory: one it cd'ed to may lie outside
        // the backend's workspace roots.
        cwd: latest?.cwd || workspace?.path || '',
        shell: latest?.shell || '',
        rows: size.rows,
        cols: size.cols,
        preserveOutput: true,
        autoStart: true,
      });
    }, delay);
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [target, isSsh, connectionState, session.openTerminalSession, terminal?.status, terminal?.stopRequested, terminalId, workspace]);

  const handleTerminalData = useCallback((data: string) => {
    const current = terminalByIdRef.current[terminalId];
    if (!target || !current || current.status !== 'running') return;
    session.sendTerminalInput(terminalId, tenantId, data);
  }, [session.sendTerminalInput, target, tenantId, terminalId]);

  const handleTerminalResize = useCallback((rows: number, cols: number) => {
    terminalSizeRef.current = { rows, cols };
    viewSizeRef.current = { rows, cols };
    setViewReady(true);
    const current = terminalByIdRef.current[terminalId];
    if (!target || !current || current.status !== 'running') return;
    if (current.rows === rows && current.cols === cols) return;
    session.resizeTerminalSession(terminalId, tenantId, rows, cols);
  }, [session.resizeTerminalSession, target, tenantId, terminalId]);

  const defaultPath = workspace?.path || '';
  const [cwdDraft, setCwdDraft] = useState(defaultPath);
  const editingCwdRef = useRef(false);

  useEffect(() => {
    setCwdDraft(workspace?.path || '');
  }, [workspace?.path]);

  const handleCwdSubmit = (targetPath: string) => {
    const trimmed = targetPath.trim();
    if (!trimmed || !terminalId || !workspace) return;
    session.sendTerminalInput(terminalId, tenantId, `cd "${trimmed.replace(/"/g, '\\"')}"\r`);
  };

  // Activity, attention and notifications for the tab strip.
  const visibleRef = useRef(false);
  visibleRef.current = isActive && shown;
  useEffect(() => {
    if (isActive && shown) patchTerminalActivity(terminalId, { attention: false });
  }, [isActive, shown, terminalId]);
  const printingTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(printingTimerRef.current), []);
  const lastProgramNoticeRef = useRef(0);
  const notify = useCallback((title: string, body: string) => {
    if (document.hasFocus()) {
      toast.info(title, { description: body });
      return;
    }
    postCompletionNotification({ title, body, tag: `terminal-${terminalId}`, onActivate: () => session.openPanel('Terminal') });
  }, [session.openPanel, terminalId]);
  const label = isSsh ? `ssh ${sshHost}` : t('workbench.tabTerminal');
  const terminalHandlers: XtermTerminalHandlers = {
    onData: handleTerminalData,
    onResize: handleTerminalResize,
    onClear: () => session.clearTerminalOutput(terminalId),
    onRequestSnapshot: () => session.requestTerminalSnapshot(terminalId),
    onPasteImages: async (files) => {
      const backendId = (isSsh ? sshBackendId : terminal?.backendConnectionId) || session.activeBackendConnectionId;
      const api = backendApi(session.settingsForBackend(backendId));
      const pending = toast.info(t('xterm.imageUploading', { count: String(files.length) }), { timeout: 0 });
      try {
        return await uploadTerminalImages(files, isSsh && sshHost
          ? { kind: 'ssh', api, backendId, host: sshHost }
          : { kind: 'backend', api });
      } catch (error) {
        toast.danger(t('xterm.imageUploadFailed'), { description: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally {
        toast.close(pending);
      }
    },
    onCwd: (path) => {
      liveCwdRef.current = path;
      patchTerminalActivity(terminalId, { cwd: path });
      if (!editingCwdRef.current) setCwdDraft(path);
    },
    onTitle: (title) => patchTerminalActivity(terminalId, { title: title.trim().slice(0, 40) }),
    onActivity: () => {
      patchTerminalActivity(terminalId, { printing: true });
      window.clearTimeout(printingTimerRef.current);
      printingTimerRef.current = window.setTimeout(() => patchTerminalActivity(terminalId, { printing: false }), PRINTING_MS);
    },
    onBell: () => {
      if (!visibleRef.current || !document.hasFocus()) patchTerminalActivity(terminalId, { attention: true });
    },
    onCommandRunning: (commandRunning) => patchTerminalActivity(terminalId, { commandRunning }),
    onCommandFinished: ({ exitCode, durationMs }) => {
      const seen = visibleRef.current && document.hasFocus();
      if (seen) return;
      patchTerminalActivity(terminalId, { attention: true });
      if (durationMs >= COMMAND_NOTIFY_MS) {
        notify(t('xterm.commandFinished', { terminal: label }), exitCode === null || exitCode === 0
          ? t('xterm.commandSucceeded', { seconds: String(Math.round(durationMs / 1000)) })
          : t('xterm.commandFailed', { code: String(exitCode), seconds: String(Math.round(durationMs / 1000)) }));
      }
    },
    onNotification: ({ title, body }) => {
      const now = Date.now();
      if (now - lastProgramNoticeRef.current < PROGRAM_NOTIFY_INTERVAL_MS) return;
      lastProgramNoticeRef.current = now;
      if (!visibleRef.current) patchTerminalActivity(terminalId, { attention: true });
      notify(title || label, body);
    },
    onProgress: ({ state, value }) => patchTerminalActivity(terminalId, { progress: state === 0 ? null : { state, value } }),
    onOpenFile: workspace ? (path) => {
      const resolved = resolveTerminalPath(path, liveCwdRef.current || terminal?.cwd || workspace.path, workspace.path);
      if (resolved) session.openPanel('Files', { filePath: resolved });
      else toast.info(t('xterm.fileOutsideWorkspace'));
    } : undefined,
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
            <RiServerLine className="size-4 shrink-0 text-foreground-icon-secondary" />
            <span className="truncate text-body-medium text-text-primary">{sshHost}</span>
            {terminal ? <Chip variant="caption" color="soft">{terminalStatusLabel(terminal.status)}</Chip> : null}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCwdSubmit(cwdDraft);
            }}
            className="min-w-0 flex-1"
          >
            <Input
              aria-label={t('workbench.terminalPath')}
              size="small"
              value={cwdDraft}
              onChange={setCwdDraft}
              onFocus={() => { editingCwdRef.current = true; }}
              onBlur={() => {
                editingCwdRef.current = false;
                if (liveCwdRef.current) setCwdDraft(liveCwdRef.current);
              }}
              placeholder="/path/to/directory..."
              inputClassName="text-caption-1-regular"
            />
          </form>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <Chip variant="caption" color="soft">
            {connectionState === 'open'
              ? session.connectionHealth.latencyMs === null ? t('workbench.detecting') : latencyLabelOf(session.connectionHealth.latencyMs)
              : t('workbench.disconnected')}
          </Chip>
          {sshEnded ? (
            <ExpandableAction
              icon={RiRefreshLine}
              label={t('ssh.terminal.reconnect')}
              disabled={connectionState !== 'open'}
              onClick={reconnectSsh}
              aria-label={t('ssh.terminal.reconnect')}
            />
          ) : (
            <ExpandableAction
              tone="danger"
              icon={RiStopCircleLine}
              label={t('workbench.stop')}
              disabled={!terminalId || !terminal || terminal.status === 'exited'}
              onClick={() => {
                manualStopRef.current = true;
                if (reconnectTimerRef.current !== null) {
                  window.clearTimeout(reconnectTimerRef.current);
                  reconnectTimerRef.current = null;
                }
                if (terminalId) {
                  session.stopTerminalSession(terminalId, tenantId);
                }
              }}
              aria-label={t('workbench.stopTerminal')}
            />
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-background-secondary-default">
        <XtermTerminal
          stream={stream}
          isActive={isActive}
          isDisabled={!target || terminal?.status !== 'running'}
          {...terminalHandlers}
        />
      </div>
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

  // Opening the tab (or switching to a conversation without a diff yet)
  // reads it right away instead of showing an empty pane.
  const conversationId = conversation?.id;
  const hasState = Boolean(state);
  useEffect(() => {
    if (conversationId && !hasState) void session.requestGitDiff(conversationId, selectedRepoPath);
    // Only a conversation change triggers the read; refresh is manual.
  }, [conversationId]);

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
          <Input
            aria-label={t('workbench.gitPath')}
            size="small"
            value={pathDraft}
            onChange={setPathDraft}
            placeholder="/path/to/workspace..."
            inputClassName="text-caption-1-regular"
          />
        </form>
        <div className="flex shrink-0 items-center gap-2">
          <ExpandableAction
            icon={RiRefreshLine}
            iconClassName={cx(state?.status === 'loading' && 'animate-spin motion-reduce:animate-none')}
            label={t('workbench.refresh')}
            disabled={!conversation || state?.status === 'loading'}
            onClick={handleRefresh}
            aria-label={t('workbench.refreshGitDiff')}
          />
        </div>
      </div>
      <ScrollArea
        surface="secondary"
        className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-background-secondary-default"
        contentClassName="p-3"
      >
        <GitDiffText state={state} />
      </ScrollArea>
    </div>
  );
}

const FILE_ICONS: Array<[RegExp, IconComponent]> = [
  [/\.(tsx?|jsx?|mjs|cjs|rs|go|py|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|css|scss|less|html?|sql|lua|dart|zig)$/i, RiFileCodeLine],
  [/\.(json|jsonc|json5)$/i, RiBracesLine],
  [/(\.(ya?ml|toml|ini|conf|cfg|properties)|^\.env.*|^\.(git|npm|prettier|eslint|editor)[a-z]*rc?$|^\.gitignore$)$/i, RiFileSettingsLine],
  [/\.(lock|lockb)$|^pnpm-lock\.yaml$/i, RiLockLine],
  [/\.mdx?$/i, RiMarkdownLine],
  [/\.(png|jpe?g|gif|svg|webp|ico|avif|bmp|tiff?)$/i, RiImageLine],
  [/\.(sh|bash|zsh|fish|ps1|bat|cmd)$/i, RiTerminalBoxLine],
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, RiFileZipLine],
  [/\.pdf$/i, RiFilePdf2Line],
  [/\.(txt|log|csv|tsv|rst)$/i, RiFileTextLine],
];

/** The tree icon for a file, by its name. */
function fileIcon(name: string): IconComponent {
  // Lock files first: `pnpm-lock.yaml` would otherwise read as config.
  if (/\.(lock|lockb)$|^pnpm-lock\.yaml$/i.test(name)) return RiLockLine;
  return FILE_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? RiFileLine;
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

function FilesPane({ session, target, onTargetChange, remote, remoteBackendId, onRemoteRebind }: {
  session: TodeXSession;
  /** Backend a remote binding's connection lives on. */
  remoteBackendId?: string;
  target?: OpenPanelOptions;
  onTargetChange?: (target: OpenPanelOptions) => void;
  /** Bind the pane to a remote SFTP/FTP connection instead of the workspace. */
  remote?: RemoteFilesBinding;
  onRemoteRebind?: (remote: RemoteFilesBinding) => void;
}) {
  const t = useT();
  const targetChangeRef = useRef(onTargetChange);
  targetChangeRef.current = onTargetChange;
  // Remote tabs talk to the SSH view's backend; workspace files to the focused one.
  const filesBackendId = remote && remoteBackendId ? remoteBackendId : session.activeBackendConnectionId;
  const { serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified } = session.settingsForBackend(filesBackendId);
  const api = useCallback(() => backendApi({ serverUrl, deviceSecret, encryptionProtocol, encryptionPublicKey, transportVerified }), [deviceSecret, encryptionProtocol, encryptionPublicKey, serverUrl, transportVerified]);
  const workspacePath = session.activeWorkspace?.path || '';
  // shell.openPath/showItemInFolder act on the desktop's own filesystem, so
  // the menu only makes sense when the backend runs on this machine; a
  // container backend's paths go through its published mappings, and
  // without any the menu stays hidden.
  const filesServerVersion = session.backendLinkStatus[filesBackendId]?.serverVersion;
  const filesDeployment = filesServerVersion?.deployment ?? 'host';
  const filesPathMappings = filesServerVersion?.pathMappings;
  const hostPathFor = useMemo(() => (platform.files ? systemShellPathResolver({
    loopback: isLocalBackendUrl(serverUrl),
    deployment: filesDeployment,
    pathMappings: filesPathMappings ?? [],
    windows: platform.os === 'win32',
  }, mapBackendPathToHost) : null), [filesDeployment, filesPathMappings, serverUrl]);
  const source: FileSource = useMemo(
    () => (remote ? remoteFileSource(api, remote) : workspaceFileSource(api, workspacePath, Boolean(hostPathFor))),
    [api, hostPathFor, remote, workspacePath],
  );
  const remoteConnector = useRemoteConnector(api, filesBackendId);
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [focused, setFocused] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(new Set());
  // Directories whose listing is in flight (their placeholder row spins).
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  // A narrow pane stacks the tree over the preview: side by side, the tree
  // column shrank to icons only.
  const splitRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const node = splitRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setStacked(entry.contentRect.width < 560));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
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
    setLoadingDirs((current) => new Set(current).add(directory));
    if (!quiet) setError('');
    try {
      const children = sortFileEntries(await source.list(directory));
      setEntries((current) => directory === currentPath ? children : replaceFileTreeChildren(current, directory, children));
      setExpandedKeys((current) => new Set([...current, directory]));
      return true;
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : t('workbench.dirReadFailed'));
      return false;
    } finally {
      setLoading(false);
      setLoadingDirs((current) => {
        const next = new Set(current);
        next.delete(directory);
        return next;
      });
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

  const [contextMenu, setContextMenu] = useState<{ hostPath: string; x: number; y: number } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const canUseSystemShell = source.canUseSystemShell;
  const revealInManagerLabel = platform.os === 'darwin'
    ? t('workbench.revealInFinder')
    : platform.os === 'win32'
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
    // A container path no mapping covers does not exist on this machine.
    const hostPath = hostPathFor?.(path);
    if (hostPath) setContextMenu({ hostPath, x: event.clientX, y: event.clientY });
  };

  const runFileContextAction = async (action: 'open' | 'open-with' | 'reveal') => {
    const path = contextMenu?.hostPath;
    setContextMenu(null);
    const files = platform.files;
    if (!path || !files) return;
    try {
      if (action === 'open') await files.openPath(path);
      else if (action === 'open-with') await files.openWith(path);
      else await files.reveal(path);
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

  // A row under a branch that is loading, empty or cut off. Disabled, so it
  // never takes selection or focus.
  const noteRow = (id: string, label: string, busy = false) => (
    <TreeViewItem
      key={id}
      id={id}
      label={label}
      icon={null}
      isDisabled
      className="cursor-default text-text-tertiary"
      trailingContent={busy ? <Spinner size="sm" aria-hidden /> : undefined}
    />
  );

  // Children of a directory row. One not listed yet gets a loading row, so
  // it shows a disclosure chevron and lists itself when expanded.
  const directoryChildren = (path: string, children: FileTreeEntry[] | undefined): ReactNode => {
    if (!children) return noteRow(`${path}\u0000loading`, t('workbench.treeLoading'), true);
    if (children.length === 0) {
      return loadingDirs.has(path)
        ? noteRow(`${path}\u0000loading`, t('workbench.treeLoading'), true)
        : noteRow(`${path}\u0000empty`, t('workbench.treeEmpty'));
    }
    return [
      ...children.map(renderEntry),
      ...(source.listLimit && children.length >= source.listLimit
        ? [noteRow(`${path}\u0000more`, t('workbench.treeTruncated', { count: source.listLimit }))]
        : []),
    ];
  };

  const renderEntry = (entry: FileTreeEntry): ReactNode => {
    const directory = entry.kind === 'directory' || Boolean(entry.children);
    return (
      <TreeViewItem
        key={entry.path}
        icon={directory ? RiFolder3Line : entry.kind === 'symlink' ? RiLinksLine : fileIcon(entry.name)}
        expandedIcon={directory ? RiFolderOpenLine : undefined}
        id={entry.path}
        label={entry.name}
        // Dotfiles recede, as in most file managers.
        className={entry.name.startsWith('.') ? 'text-text-secondary' : undefined}
        onContextMenu={canUseSystemShell ? (event) => openEntryContextMenu(event, entry.path) : undefined}
      >
        {directory ? directoryChildren(entry.path, entry.children) : null}
      </TreeViewItem>
    );
  };

  const toggleTree = () => {
    if (treePanelRef.current?.isCollapsed()) treePanelRef.current.expand();
    else treePanelRef.current?.collapse();
  };

  const toolbarButton = (label: string, icon: IconComponent, onPress: () => void, isDisabled = false) => (
    <IconAction icon={icon} size="sm" aria-label={label} tooltip disabled={busy || isDisabled} onClick={onPress} />
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
          <Input
            aria-label={t('workbench.pathLabel')}
            size="small"
            value={pathDraft}
            onChange={setPathDraft}
            placeholder="/path/to/directory..."
            inputClassName="text-caption-1-regular"
          />
        </form>
        <div className="flex shrink-0 items-center gap-2">
          {remote ? toolbarButton(t('ssh.files.reconnect'), RiLink, () => void reconnectRemote()) : null}
          <ExpandableAction
            icon={RiRefreshLine}
            label={t('workbench.refresh')}
            disabled={!currentPath || loading}
            onClick={() => currentPath && void loadDirectory(currentPath)}
            aria-label={t('workbench.refreshDir')}
          />
          <ExpandableAction
            icon={treeCollapsed ? RiArrowRightDoubleLine : RiArrowLeftDoubleLine}
            label={treeCollapsed ? t('workbench.expandTree') : t('workbench.collapseTree')}
            onClick={toggleTree}
            aria-label={treeCollapsed ? t('workbench.showTree') : t('workbench.collapseTree')}
          />
        </div>
      </div>
      {hasFileOperations ? (
        <div className="mb-3 flex items-center gap-1">
          {busy ? <Spinner size="sm" aria-label={t('ssh.files.working')} /> : null}
          {source.upload ? toolbarButton(t('ssh.files.upload'), RiUpload2Line, () => uploadInputRef.current?.click(), !currentPath) : null}
          {source.download ? toolbarButton(t('ssh.files.download'), RiDownload2Line, () => {
            const download = source.download;
            if (!download || !selectedEntry) return;
            void runOperation(t('ssh.files.download'), () => download(selectedEntry.path));
          }, !selectedEntry || selectedIsDirectory) : null}
          {source.mkdir ? toolbarButton(t('ssh.files.newFolder'), RiFolderAddLine, () => {
            setOperationName('');
            setOperation({ kind: 'mkdir', directory: targetDirectory });
          }, !currentPath) : null}
          {source.rename ? toolbarButton(t('ssh.files.rename'), RiEdit2Line, () => {
            if (!selectedEntry) return;
            setOperationName(selectedEntry.name);
            setOperation({ kind: 'rename', path: selectedEntry.path });
          }, !selectedRemovable) : null}
          {source.remove ? toolbarButton(t('ssh.files.delete'), RiDeleteBinLine, () => {
            if (!selectedEntry) return;
            setOperation({ kind: 'delete', path: selectedEntry.path, isDirectory: selectedIsDirectory });
          }, !selectedRemovable) : null}
          <span className="ms-1.5 min-w-0 truncate text-caption-1-regular text-text-tertiary">{t('ssh.files.target', { path: targetDirectory || '/' })}</span>
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
      <div ref={splitRef} className="flex min-h-0 flex-1">
      <Resizable
        key={stacked ? 'stacked' : 'side'}
        autoSaveId={stacked ? 'todex.files-pane.stacked' : 'todex.files-pane.v2'}
        orientation={stacked ? 'vertical' : 'horizontal'}
        className="min-h-0 flex-1"
        onLayoutChange={() => setTreeCollapsed(Boolean(treePanelRef.current?.isCollapsed()))}
      >
        <Resizable.Panel
          id="file-tree"
          handleRef={treePanelRef}
          defaultSize={stacked ? '45%' : '260px'}
          minSize={stacked ? '120px' : '200px'}
          maxSize={stacked ? '80%' : '60%'}
          collapsedSize="0px"
          collapsible
          onCollapse={() => setTreeCollapsed(true)}
          onExpand={() => setTreeCollapsed(false)}
          className="min-h-0"
        >
          <ScrollArea
            className="h-full overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default"
            contentClassName="p-1.5"
          >
            <TreeView
              key={`${source.key}:${currentPath || 'empty'}`}
              aria-label={remote ? t('ssh.files.treeLabel', { label: remote.label }) : t('workbench.workspaceFiles')}
              size="sm"
              className="rounded-none border-0 bg-transparent p-0"
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
              onExpandedChange={(keys) => {
                // Expanding a directory that was never listed lists it.
                for (const key of keys) {
                  if (expandedKeys.has(key)) continue;
                  const entry = findFileTreeEntry(entries, String(key));
                  if (entry?.kind === 'directory' && !entry.children) void loadDirectory(entry.path);
                }
                setExpandedKeys(keys);
              }}
            >
              <TreeViewItem
                key={currentPath || 'root'}
                icon={RiFolder3Line}
                expandedIcon={RiFolderOpenLine}
                id={currentPath || 'root'}
                label={rootName}
                onContextMenu={canUseSystemShell && currentPath ? (event) => openEntryContextMenu(event, currentPath) : undefined}
              >
                {currentPath ? directoryChildren(currentPath, loadingDirs.has(currentPath) && entries.length === 0 ? undefined : entries) : null}
              </TreeViewItem>
            </TreeView>
          </ScrollArea>
        </Resizable.Panel>
        <Resizable.Handle aria-label={t('workbench.resizeTree')} />
        <Resizable.Panel defaultSize={stacked ? '55%' : '70%'} minSize={stacked ? '120px' : '240px'} className="min-h-0">
          <ScrollArea
            surface="secondary"
            className="h-full overflow-hidden rounded-2xl bg-background-secondary-default"
            contentClassName="p-3"
          >
            <p className="mb-2 truncate text-caption-1-regular text-text-tertiary">{selected || t('workbench.selectFile')}</p>
            {fileLoading ? <Spinner size="sm" aria-label={t('workbench.readingFile')} /> : error ? null : <WorkspaceFilePreview file={file} onAddReference={source.canAddReference ? addReferenceToChat : undefined} onSaveFile={saveFile} onReloadFile={reloadFile} onDirtyChange={(dirty) => { fileDirtyRef.current = dirty; }} />}
          </ScrollArea>
        </Resizable.Panel>
      </Resizable>
      </div>
      <ContextMenu position={contextMenu} onClose={closeContextMenu}>
        <Menu aria-label={t('workbench.fileMenu')}>
          <MenuItem id="open" icon={RiExternalLinkLine} textValue={t('workbench.open')} onAction={() => void runFileContextAction('open')}>{t('workbench.open')}</MenuItem>
          <MenuItem id="open-with" icon={RiAppsLine} textValue={t('workbench.openWith')} onAction={() => void runFileContextAction('open-with')}>{t('workbench.openWith')}</MenuItem>
          <MenuSeparator />
          <MenuItem id="reveal" icon={RiFolderOpenLine} textValue={revealInManagerLabel} onAction={() => void runFileContextAction('reveal')}>{revealInManagerLabel}</MenuItem>
        </Menu>
      </ContextMenu>
      <Modal
        isOpen={operation?.kind === 'mkdir' || operation?.kind === 'rename'}
        onOpenChange={(open) => { if (!open) setOperation(null); }}
        title={operation?.kind === 'rename' ? t('ssh.files.rename') : t('ssh.files.newFolder')}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOperation(null)}>{t('common.cancel')}</Button>
            <Button type="submit" form="file-operation-form">{t('common.save')}</Button>
          </>
        )}
      >
        <form id="file-operation-form" onSubmit={(event) => { event.preventDefault(); void submitOperation(); }}>
          <Input label={t('ssh.files.name')} value={operationName} onChange={setOperationName} autoFocus />
        </form>
      </Modal>
      <ConfirmDialog
        isOpen={operation?.kind === 'delete'}
        onOpenChange={(open) => { if (!open) setOperation(null); }}
        title={t('ssh.files.deleteTitle')}
        description={(
          <span className="break-all">
            {operation?.kind === 'delete' ? t(operation.isDirectory ? 'ssh.files.deleteDirectoryBody' : 'ssh.files.deleteFileBody', { path: operation.path }) : null}
          </span>
        )}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => void submitOperation()}
      />
      {remoteConnector.dialog}
    </div>
  );
}

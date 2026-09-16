import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { RiAppsLine, RiCloseLine, RiTerminalBoxLine, RiGitBranchLine, RiAddLine, RiArrowLeftDoubleLine, RiArrowRightDoubleLine, RiExternalLinkLine, RiFileTextLine, RiFolder3Line, RiFolderOpenLine, RiGlobalLine, RiFocus3Line, RiRefreshLine, RiStopCircleLine } from '@remixicon/react';
import { Button, Chip, Dropdown, Input, Label, Popover, ScrollShadow, Spinner, TextField, Tooltip, toast } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { ContextMenu as HeroContextMenu, FileTree } from '@heroui-pro/react';
import { Resizable } from '@heroui-pro/react/resizable';
import type { PanelImperativeHandle } from '@heroui-pro/react/resizable';
import { WorkspaceFilePreview, type PreviewFile, type ReferenceSelection } from '../components/WorkspaceFilePreview';
import { useNoticeToast } from '../components/NoticeToast';
import { XtermTerminal } from '../components/XtermTerminal';
import type { TodeXSession } from '../session/useTodeXSession';
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  latencyLabelOf,
  terminalIdForConversation,
  terminalStatusLabel,
} from '../session/helpers';
import type { OpenPanelOptions, WorkbenchTab } from '../lib/panels';
import { normalizeWorkbenchLayout } from '../session/workbenchLayout';
import { SETTINGS_STORAGE_KEY, attachmentId, referenceToken, uniqueReferenceName } from '../session/helpers';
import { V2ApiClient } from '@todex/protocol/v2';
import { deviceIdentityFromSecret } from '@todex/protocol/deviceAuth';
import { isLoopbackUrl } from '@todex/protocol/mobileParity';
import { t, useT, type MessageKey } from '../i18n';

type Props = {
  scopeKey?: string;
  onTargetConsumed?: () => void;
  session: TodeXSession;
  tab: WorkbenchTab;
  target?: OpenPanelOptions;
  onTabChange: (tab: WorkbenchTab) => void;
};

type WorkbenchItem = { id: string; type: WorkbenchTab; title: string; target?: OpenPanelOptions };

type StoredWorkbenchState = {
  items: WorkbenchItem[];
  activeId: string;
};

const WORKBENCH_TYPES = new Set<WorkbenchTab>(['terminal', 'browser', 'files', 'git-diff']);

const WORKBENCH_LABEL_KEYS: Record<WorkbenchTab, MessageKey> = {
  terminal: 'workbench.tabTerminal',
  browser: 'workbench.tabBrowser',
  files: 'workbench.tabFiles',
  'git-diff': 'workbench.tabGitDiff',
};

const workbenchLabel = (tab: WorkbenchTab) => t(WORKBENCH_LABEL_KEYS[tab]);

const WORKBENCH_ICONS = {
  terminal: RiTerminalBoxLine,
  browser: RiGlobalLine,
  files: RiFileTextLine,
  'git-diff': RiGitBranchLine,
};

function parseStoredWorkbenchState(value: unknown): StoredWorkbenchState {
  if (!value || typeof value !== 'object') return { items: [], activeId: '' };
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
  const activeId = typeof candidate.activeId === 'string' && items.some((item) => item.id === candidate.activeId)
    ? candidate.activeId
    : items[0]?.id ?? '';
  return { items: items.map(item => ({ ...item, target: normalizeWorkbenchLayout({ target: item.target }).target })), activeId };
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

export function WorkbenchPanel({ session, tab, target, onTabChange, scopeKey = session.activeConversation?.id || '', onTargetConsumed }: Props) {
  const t = useT();
  const storageKey = `${SETTINGS_STORAGE_KEY}.workbenchTabs.v1:${scopeKey}`;
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [restored, setRestored] = useState(false);
  const requestedTargetRef = useRef(target);
  const openedTargetRef = useRef<{ target: OpenPanelOptions; tab: WorkbenchTab } | null>(null);
  requestedTargetRef.current = target;

  useEffect(() => {
    let cancelled = false;
    void window.todexDesktop.store.get(storageKey)
      .then((value) => {
        if (cancelled) return;
        const stored = parseStoredWorkbenchState(value);
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
    void window.todexDesktop.store.set(storageKey, { items: items.map(item => ({ ...item, target: normalizeWorkbenchLayout({ target: item.target }).target })), activeId } satisfies StoredWorkbenchState)
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
  const addTab = (type: WorkbenchTab) => {
    if (!restored) return;
    const count = items.filter((item) => item.type === type).length + 1;
    const item = { id: `${type}-${Date.now()}`, type, title: `${workbenchLabel(type)} ${count}` };
    setItems((current) => [...current, item]);
    setActiveId(item.id);
    onTabChange(type);
  };
  const closeTab = (id: string) => {
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      if (id === activeId) {
        const replacement = next[Math.max(0, current.findIndex((item) => item.id === id) - 1)] ?? next[0];
        setActiveId(replacement?.id ?? '');
        if (replacement) onTabChange(replacement.type);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 items-center border-b border-separator px-2">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {items.map((item) => {
            const Icon = WORKBENCH_ICONS[item.type];
            const workspacePath = session.activeWorkspace?.path;
            const location = item.type === 'terminal'
              ? session.terminalById[terminalIdForConversation(scopeKey, item.id)]?.cwd || workspacePath
              : item.type === 'browser'
                ? item.target?.url || item.target?.filePath || 'http://127.0.0.1:7345'
                : item.target?.filePath || workspacePath;
            const title = location ? `${workbenchLabel(item.type)} ${location}` : item.title;
            return (
              <div key={item.id} className={`group flex h-10 shrink-0 items-center border-r border-separator ${item.id === activeId ? 'bg-surface text-foreground' : 'text-muted'}`}>
                <Tooltip delay={200}>
                  <Button
                    isIconOnly variant="ghost" aria-label={title} aria-pressed={item.id === activeId}
                    className="size-10 min-w-10 rounded-none text-inherit"
                    onPress={() => { setActiveId(item.id); onTabChange(item.type); }}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </Button>
                  <Tooltip.Content placement="bottom" className="max-w-sm break-all text-xs">
                    {title}
                  </Tooltip.Content>
                </Tooltip>
                <Button
                  isIconOnly size="sm" variant="ghost" aria-label={t('workbench.closeTab', { title })}
                  className="mr-1 size-5 min-w-5 rounded-sm text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                  onPress={() => closeTab(item.id)}
                >
                  <RiCloseLine aria-hidden="true" className="size-3" />
                </Button>
              </div>
            );
          })}
        </div>
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
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!active ? (
          <div className="text-muted flex h-full items-center justify-center text-sm">{t('workbench.noTabs')}</div>
        ) : null}
        {items.map((item) => (
          <div key={item.id} className={item.id === active?.id ? 'h-full' : 'hidden'}>
            {item.type === 'terminal' ? (
              <TerminalPane
                isActive={item.id === active?.id}
                session={session}
                terminalId={terminalIdForConversation(scopeKey, item.id)}
              />
            ) : null}
            {item.type === 'browser' ? <BrowserPane workspacePath={session.activeWorkspace?.path} session={session} target={item.type === tab && item.id === active?.id && (target?.filePath || target?.url) ? target : item.target} onTargetChange={next => updateTabTarget(item.id, next)} /> : null}
            {item.type === 'files' ? <FilesPane session={session} target={item.type === tab && item.id === active?.id && (target?.filePath || target?.url) ? target : item.target} onTargetChange={next => updateTabTarget(item.id, next)} /> : null}
            {item.type === 'git-diff' ? <GitDiffPane session={session} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalPane({ session, terminalId, isActive }: { session: TodeXSession; terminalId: string; isActive: boolean }) {
  const t = useT();
  const workspace = session.activeWorkspace;
  const conversation = session.activeConversation;
  const backendIdentity = workspace?.backendConnectionId || session.activeBackendConnectionId || session.settings.serverUrl;
  const autoStartAttempts = useRef(new Set<string>());
  const manualStopRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
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
  }, [terminalId, backendIdentity]);

  useEffect(() => {
    if (!terminal) return;
    terminalSizeRef.current = { rows: terminal.rows, cols: terminal.cols };
  }, [terminal?.cols, terminal?.rows]);

  useEffect(() => {
    if (!workspace || !conversation || !terminalId || session.connectionState !== 'open') {
      return;
    }
    const current = terminalByIdRef.current[terminalId];
    if (current && current.status !== 'idle') {
      return;
    }
    const attemptKey = `${conversation.id}:${terminalId}`;
    if (autoStartAttempts.current.has(attemptKey)) {
      return;
    }
    autoStartAttempts.current.add(attemptKey);
    session.requestTerminalStatus(workspace, conversation, terminalId);
    const timeoutId = window.setTimeout(() => {
      const latest = terminalByIdRef.current[terminalId];
      if (!latest || latest.status === 'idle') {
        const size = terminalSizeRef.current;
        session.startTerminalSession(workspace, conversation, {
          terminalId,
          cwd: workspace.path,
          shell: '',
          rows: size.rows,
          cols: size.cols,
        });
      }
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [
    conversation?.id,
    session.connectionState,
    session.requestTerminalStatus,
    session.startTerminalSession,
    terminalId,
    workspace?.id,
    workspace?.path,
  ]);

  useEffect(() => {
    if (!workspace || !conversation || !terminalId || session.connectionState !== 'open' || manualStopRef.current) {
      return;
    }
    if (terminal?.status === 'running') {
      reconnectAttemptRef.current = 0;
      return;
    }
    if (terminal?.status !== 'error' && terminal?.status !== 'exited') {
      return;
    }
    if (reconnectTimerRef.current !== null) {
      return;
    }
    const delay = Math.min(10_000, 1000 * 2 ** reconnectAttemptRef.current);
    reconnectAttemptRef.current += 1;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      const latest = terminalByIdRef.current[terminalId];
      const size = terminalSizeRef.current;
      session.startTerminalSession(workspace, conversation, {
        terminalId,
        cwd: latest?.cwd || workspace.path,
        shell: latest?.shell || '',
        rows: size.rows,
        cols: size.cols,
      });
    }, delay);
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [conversation, session.connectionState, session.startTerminalSession, terminal?.status, terminalId, workspace]);

  const handleTerminalData = useCallback((data: string) => {
    const current = terminalByIdRef.current[terminalId];
    if (!workspace || !current || current.status !== 'running') return;
    session.sendTerminalInput(terminalId, workspace.tenantId || session.settings.tenantId, data);
  }, [session.sendTerminalInput, session.settings.tenantId, terminalId, workspace]);

  const handleTerminalResize = useCallback((rows: number, cols: number) => {
    terminalSizeRef.current = { rows, cols };
    const current = terminalByIdRef.current[terminalId];
    if (!workspace || !current || current.status !== 'running') return;
    if (current.rows === rows && current.cols === cols) return;
    session.resizeTerminalSession(terminalId, workspace.tenantId || session.settings.tenantId, rows, cols);
  }, [session.resizeTerminalSession, session.settings.tenantId, terminalId, workspace]);

  const defaultPath = workspace?.path || '';
  const [cwdDraft, setCwdDraft] = useState(defaultPath);

  useEffect(() => {
    setCwdDraft(workspace?.path || '');
  }, [workspace?.path]);

  const handleCwdSubmit = (targetPath: string) => {
    const trimmed = targetPath.trim();
    if (!trimmed || !terminalId || !workspace) return;
    session.sendTerminalInput(terminalId, workspace.tenantId || session.settings.tenantId, `cd "${trimmed.replace(/"/g, '\\"')}"\r`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
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
        <div className="flex shrink-0 items-center gap-2">
          <Chip size="sm" variant="soft">
            {session.connectionState === 'open'
              ? session.connectionHealth.latencyMs === null ? t('workbench.detecting') : latencyLabelOf(session.connectionHealth.latencyMs)
              : t('workbench.disconnected')}
          </Chip>
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
              if (terminalId) {
                session.stopTerminalSession(terminalId, workspace?.tenantId || session.settings.tenantId);
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
        </div>
      </div>
      <div className="bg-surface-secondary min-h-0 flex-1 overflow-hidden rounded-xl border border-separator">
        <XtermTerminal
          entries={terminal?.output ?? []}
          isActive={isActive}
          isDisabled={!conversation || terminal?.status !== 'running'}
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
  const defaultUrl = target?.url ? target.url : (target?.filePath ? '' : 'http://127.0.0.1:7345');
  const [draft, setDraft] = useState(defaultUrl || 'http://127.0.0.1:7345');
  const [url, setUrl] = useState(defaultUrl);
  const [srcDoc, setSrcDoc] = useState('');
  const [error, setError] = useState('');
  const [inspect, setInspect] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const selectedRef = useRef<HTMLElement | null>(null);
  const selectionAnchorRef = useRef<HTMLElement | null>(null);
  useNoticeToast(error, { variant: 'danger', scope: workspacePath });

  const navigateTo = useCallback((input: string) => {
    const trimmed = input.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(t('workbench.httpOnly'));
      const host = parsed.hostname.toLowerCase();
      const loopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
      if (!loopback) throw new Error(t('workbench.loopbackOnly'));
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
    if (frameRef.current) {
      if (url) {
        frameRef.current.src = url;
      } else if (srcDoc) {
        frameRef.current.srcdoc = srcDoc;
      }
    }
  };

  useEffect(() => {
    if (target?.url) {
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
    const frame = frameRef.current;
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
        const hoverOverlay = createOverlay('#0ea5e9');
        const selectedOverlay = createOverlay('#2563eb');
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
    let cleanup = bind();
    const handleLoad = () => {
      cleanup?.();
      selectedRef.current = null;
      selectionAnchorRef.current = null;
      cleanup = bind();
    };
    frame.addEventListener('load', handleLoad);
    return () => {
      frame.removeEventListener('load', handleLoad);
      cleanup?.();
    };
  }, [appendReference, inspect]);

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
          <iframe ref={frameRef} title={t('workbench.webPreview')} src={url || undefined} srcDoc={srcDoc || undefined} className="size-full border-0" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
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
  const [pathDraft, setPathDraft] = useState(workspacePath);
  useNoticeToast(state?.error !== session.lastError ? state?.error : null, { variant: 'danger', scope: conversation?.id });

  useEffect(() => {
    setPathDraft(workspacePath);
  }, [workspacePath]);

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

type FileTreeEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  children?: FileTreeEntry[];
};

function absoluteEntryPath(cwd: string, relativePath: string): string {
  return `${cwd.replace(/[\\/]$/, '')}/${relativePath.replace(/^[/\\]+/, '').replace(/[/\\]+/g, '/')}`;
}

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

function FilesPane({ session, target, onTargetChange }: { session: TodeXSession; target?: OpenPanelOptions; onTargetChange?: (target: OpenPanelOptions) => void }) {
  const t = useT();
  const targetChangeRef = useRef(onTargetChange);
  targetChangeRef.current = onTargetChange;
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Selection>(new Set());
  const [file, setFile] = useState<PreviewFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const fileRequestRef = useRef(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const treePanelRef = useRef<PanelImperativeHandle>(null);
  const appliedTargetRef = useRef<OpenPanelOptions | undefined>(undefined);
  const defaultPath = session.activeWorkspace?.path || '';
  const [currentPath, setCurrentPath] = useState(defaultPath);
  const [pathDraft, setPathDraft] = useState(defaultPath);
  useNoticeToast(error, { variant: 'danger', scope: currentPath });

  useEffect(() => {
    const next = session.activeWorkspace?.path || '';
    setCurrentPath(next);
    setPathDraft(next);
  }, [session.activeWorkspace?.path]);

  const rootName = useMemo(() => {
    if (!currentPath) return 'workspace';
    return currentPath.split(/[/\\]/).filter(Boolean).pop() || currentPath;
  }, [currentPath]);

  const readFile = useCallback(async (path: string, sourceTarget?: OpenPanelOptions) => {
    targetChangeRef.current?.(sourceTarget ?? { filePath: path });
    const request = ++fileRequestRef.current;
    setSelected(path);
    setFile(null);
    setFileLoading(true);
    setError('');
    const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, device: deviceIdentityFromSecret(session.settings.deviceSecret) });
    try {
      const next = await api.readWorkspaceFile(path);
      if (request === fileRequestRef.current) setFile(next);
    } catch (reason) {
      if (request === fileRequestRef.current) setError(reason instanceof Error ? reason.message : t('workbench.fileReadFailed'));
    } finally {
      if (request === fileRequestRef.current) setFileLoading(false);
    }
  }, [session.settings.deviceSecret, session.settings.serverUrl]);

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

  const loadDirectory = useCallback(async (directory: string) => {
    setLoading(true);
    setError('');
    const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, device: deviceIdentityFromSecret(session.settings.deviceSecret) });
    try {
      const snapshot = await api.listWorkspaceEntries(directory, '', 100);
      const children = snapshot.entries
        .map((entry) => ({ ...entry, path: absoluteEntryPath(directory, entry.path) }))
        .sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name));
      setEntries((current) => directory === currentPath ? children : replaceFileTreeChildren(current, directory, children));
      setExpandedKeys((current) => new Set([...current, directory]));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('workbench.dirReadFailed'));
    } finally {
      setLoading(false);
    }
  }, [currentPath, session.settings.deviceSecret, session.settings.serverUrl]);

  useEffect(() => {
    setEntries([]);
    setSelected('');
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
    setCurrentPath(trimmed);
  };

  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  // shell.openPath/showItemInFolder act on the desktop's own filesystem, so
  // the menu only makes sense when the backend runs on this machine.
  const canUseSystemShell = isLoopbackUrl(session.settings.serverUrl);
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
    if (entry.kind === 'directory') {
      if (!entry.children) await loadDirectory(entry.path);
      setExpandedKeys((current) => new Set([...current, entry.path]));
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

  const renderEntry = (entry: FileTreeEntry): ReactNode => (
    <FileTree.Item
      key={entry.path}
      icon={entry.kind === 'directory' ? <RiFolder3Line /> : <RiFileTextLine />}
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
            key={currentPath || 'empty'}
            aria-label={t('workbench.workspaceFiles')}
            className="w-full workbench-file-tree"
            selectedKeys={selected ? new Set([selected]) : new Set()}
            expandedKeys={expandedKeys}
            selectionMode="single"
            selectionBehavior="replace"
            onSelectionChange={(keys: Selection) => {
              const key = keys === 'all' ? '' : String([...keys][0] ?? '');
              if (key) void handleAction(key);
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
            {fileLoading ? <Spinner size="sm" aria-label={t('workbench.readingFile')} /> : error ? null : <WorkspaceFilePreview file={file} onAddReference={addReferenceToChat} />}
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
    </div>
  );
}

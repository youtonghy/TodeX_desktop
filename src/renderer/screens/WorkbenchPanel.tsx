import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RiAddLine, RiArrowLeftDoubleLine, RiArrowRightDoubleLine, RiFileTextLine, RiFolder3Line, RiGlobalLine, RiFocus3Line, RiRefreshLine, RiStopCircleLine } from '@remixicon/react';
import { Button, Chip, Dropdown, Input, Popover, ScrollShadow, TextField } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { FileTree } from '@heroui-pro/react';
import { Resizable } from '@heroui-pro/react/resizable';
import type { PanelImperativeHandle } from '@heroui-pro/react/resizable';
import { CodeBlock } from '@heroui-pro/react/code-block';
import { Markdown } from '@heroui-pro/react/markdown';
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
import { V2ApiClient } from '@todex/protocol/v2';

type Props = {
  session: TodeXSession;
  tab: WorkbenchTab;
  target?: OpenPanelOptions;
  onTabChange: (tab: WorkbenchTab) => void;
};

type WorkbenchItem = { id: string; type: WorkbenchTab; title: string };

type StoredWorkbenchState = {
  items: WorkbenchItem[];
  activeId: string;
};

const WORKBENCH_STORAGE_KEY = 'todex.desktop.workbench.v2';
const WORKBENCH_TYPES = new Set<WorkbenchTab>(['terminal', 'browser', 'files', 'git-diff']);

const WORKBENCH_LABELS: Record<WorkbenchTab, string> = {
  terminal: '终端',
  browser: '浏览器',
  files: '文件',
  'git-diff': 'Git Diff',
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
  return { items, activeId };
}

const PLACEHOLDER_FILES: Record<string, { title: string; language: string; body: string }> = {
  readme: {
    title: 'README.md',
    language: 'markdown',
    body: '# 工作区\n\n文件预览目前是前端占位。\n接入后端目录接口后，这里会显示真实文件内容。',
  },
  agent: {
    title: 'AGENTS.md',
    language: 'markdown',
    body: '# Agents\n\nTodeX 桌面端会在右侧面板预览工作区文件。\n当前后端文件接口尚未接入。',
  },
  package: {
    title: 'package.json',
    language: 'json',
    body: '{\n  "name": "workspace",\n  "private": true\n}',
  },
};

export function WorkbenchPanel({ session, tab, target, onTabChange }: Props) {
  const conversationId = session.activeConversation?.id ?? '';
  const [items, setItems] = useState<WorkbenchItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.todexDesktop.store.get(WORKBENCH_STORAGE_KEY)
      .then((value) => {
        if (cancelled) return;
        const stored = parseStoredWorkbenchState(value);
        setItems(stored.items);
        setActiveId(stored.activeId);
        const active = stored.items.find((item) => item.id === stored.activeId);
        if (active) onTabChange(active.type);
      })
      .catch((reason) => {
        console.error('Failed to restore workbench tabs', reason);
      })
      .finally(() => {
        if (!cancelled) setRestored(true);
      });
    return () => { cancelled = true; };
  }, [onTabChange]);

  useEffect(() => {
    if (!restored) return;
    void window.todexDesktop.store.set(WORKBENCH_STORAGE_KEY, { items, activeId } satisfies StoredWorkbenchState)
      .catch((reason) => {
        console.error('Failed to persist workbench tabs', reason);
      });
  }, [activeId, items, restored]);

  useEffect(() => {
    if (!restored) return;
    const next = items.find((item) => item.type === tab);
    if (next && next.id !== activeId) {
      setActiveId(next.id);
    }
  }, [activeId, items, restored, tab]);

  const active = items.find((item) => item.id === activeId) ?? null;
  const addTab = (type: WorkbenchTab) => {
    const count = items.filter((item) => item.type === type).length + 1;
    const item = { id: `${type}-${Date.now()}`, type, title: `${WORKBENCH_LABELS[type]} ${count}` };
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
          {items.map((item) => (
            <button key={item.id} type="button" className={`flex h-10 shrink-0 items-center gap-2 border-r border-separator px-3 text-xs ${item.id === activeId ? 'bg-surface font-medium' : 'text-muted'}`} onClick={() => { setActiveId(item.id); onTabChange(item.type); }}>
              {item.title}
              <span role="button" aria-label={`关闭${item.title}`} className="text-muted hover:text-foreground" onClick={(event) => { event.stopPropagation(); closeTab(item.id); }}>×</span>
            </button>
          ))}
        </div>
        <Dropdown>
          <Dropdown.Trigger
            aria-label="新建工作台标签"
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
          >
            <RiAddLine className="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Popover>
            <Dropdown.Menu onAction={(key) => addTab(String(key) as WorkbenchTab)}>
              <Dropdown.Item id="terminal" textValue="终端">终端</Dropdown.Item>
              <Dropdown.Item id="browser" textValue="浏览器">浏览器</Dropdown.Item>
              <Dropdown.Item id="files" textValue="文件">文件</Dropdown.Item>
              <Dropdown.Item id="git-diff" textValue="Git Diff">Git Diff</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!active ? (
          <div className="text-muted flex h-full items-center justify-center text-sm">暂无打开的标签</div>
        ) : null}
        {items.map((item) => (
          <div key={item.id} className={item.id === active?.id ? 'h-full' : 'hidden'}>
            {item.type === 'terminal' ? (
              <TerminalPane
                isActive={item.id === active?.id}
                session={session}
                terminalId={terminalIdForConversation(conversationId, item.id)}
              />
            ) : null}
            {item.type === 'browser' ? <BrowserPane workspacePath={session.activeWorkspace?.path} session={session} target={target} /> : null}
            {item.type === 'files' ? <FilesPane session={session} target={target} /> : null}
            {item.type === 'git-diff' ? <GitDiffPane session={session} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalPane({ session, terminalId, isActive }: { session: TodeXSession; terminalId: string; isActive: boolean }) {
  const workspace = session.activeWorkspace;
  const conversation = session.activeConversation;
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
  }, [conversation?.id]);

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
          <TextField aria-label="终端路径" className="w-full" value={cwdDraft} onChange={setCwdDraft}>
            <Input
              placeholder="/path/to/directory..."
              className="text-xs"
            />
          </TextField>
        </form>
        <div className="flex shrink-0 items-center gap-2">
          <Chip size="sm" variant="soft">
            {session.connectionState === 'open'
              ? session.connectionHealth.latencyMs === null ? '检测中' : latencyLabelOf(session.connectionHealth.latencyMs)
              : '未连接'}
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
            aria-label="停止终端"
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiStopCircleLine className="size-4" />
            </span>
            <span className="expandable-action-btn__label">停止</span>
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

function BrowserPane({ workspacePath, session, target }: { workspacePath?: string; session: TodeXSession; target?: OpenPanelOptions }) {
  const defaultUrl = target?.url ? target.url : (target?.filePath ? '' : 'http://127.0.0.1:7345');
  const [draft, setDraft] = useState(defaultUrl || 'http://127.0.0.1:7345');
  const [url, setUrl] = useState(defaultUrl);
  const [srcDoc, setSrcDoc] = useState('');
  const [error, setError] = useState('');
  const [inspect, setInspect] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const selectedRef = useRef<HTMLElement | null>(null);
  const selectionAnchorRef = useRef<HTMLElement | null>(null);

  const navigateTo = useCallback((input: string) => {
    const trimmed = input.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('仅支持 HTTP 和 HTTPS 地址');
      const host = parsed.hostname.toLowerCase();
      const loopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
      if (!loopback) throw new Error('浏览器预览仅允许访问本机地址');
      setUrl(parsed.toString());
      setDraft(parsed.toString());
      setSrcDoc('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '请输入有效的网址');
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
      setDraft(target.url);
      setUrl(target.url);
      setSrcDoc('');
      setError('');
      return;
    }
    if (!target?.filePath) return;
    setDraft(target.filePath);
    setUrl('');
    setSrcDoc('');
    setError('');
    const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, authToken: session.settings.authToken });
    void api.readWorkspaceFile(target.filePath)
      .then((file) => {
        if (!file.text) throw new Error('该网页文件无法作为文本加载');
        setSrcDoc(file.text);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '网页文件读取失败'));
  }, [session.settings.authToken, session.settings.serverUrl, target?.filePath, target?.url]);

  const appendReference = useCallback((element: HTMLElement) => {
    const tag = element.tagName.toLowerCase();
    const text = (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    const id = element.id ? `#${element.id}` : '';
    const reference = `[网页元素 ${tag}${id}${text ? `: ${text}` : ''}]`;
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
      } catch { setError('该页面禁止读取元素，无法使用检查功能'); }
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
          <TextField aria-label="地址" className="w-full" value={draft} onChange={setDraft}>
            <Input placeholder="http://127.0.0.1:..." className="text-xs" />
          </TextField>
        </form>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={!url && !srcDoc}
            onPress={handleReload}
            aria-label="刷新网页"
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiRefreshLine className="size-4" />
            </span>
            <span className="expandable-action-btn__label">刷新</span>
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
            aria-label={inspect ? '退出检查' : '选择元素'}
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiFocus3Line className="size-4" />
            </span>
            <span className="expandable-action-btn__label">{inspect ? '退出检查' : '选择元素'}</span>
          </Button>
        </div>
      </div>
      {error ? <p className="text-danger mb-2 text-xs">{error}</p> : null}
      {url || srcDoc ? (
        <div className="bg-surface min-h-0 flex-1 overflow-hidden rounded-xl border border-separator">
          <iframe ref={frameRef} title="网页预览" src={url || undefined} srcDoc={srcDoc || undefined} className="size-full border-0" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
        </div>
      ) : (
        <div className="bg-surface-secondary flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl px-6 text-center">
          <RiGlobalLine className="text-muted size-6" />
          <p className="text-sm font-medium">浏览器预览</p>
          <p className="text-muted max-w-xs text-xs">输入地址后由 backend 所在机器请求并返回内容。工作区 {workspacePath || '尚未选择'}。</p>
          <Button size="sm" variant="secondary" onPress={() => navigateTo(draft || 'http://127.0.0.1:7345')}>
            打开默认地址
          </Button>
        </div>
      )}
    </div>
  );
}

function GitDiffPane({ session }: { session: TodeXSession }) {
  const conversation = session.activeConversation;
  const state = conversation ? session.gitDiffByConversation[conversation.id] : undefined;
  const workspacePath = session.activeWorkspace?.path || '';
  const [pathDraft, setPathDraft] = useState(workspacePath);

  useEffect(() => {
    setPathDraft(workspacePath);
  }, [workspacePath]);

  const handleRefresh = () => {
    if (conversation) {
      void session.requestGitDiff(conversation.id);
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
          <TextField aria-label="Git 工作区路径" className="w-full" value={pathDraft} onChange={setPathDraft}>
            <Input placeholder="/path/to/workspace..." className="text-xs" />
          </TextField>
        </form>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={!conversation || state?.status === 'loading'}
            onPress={handleRefresh}
            aria-label="刷新 Git Diff"
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiRefreshLine className={`size-4 ${state?.status === 'loading' ? 'animate-spin' : ''}`} />
            </span>
            <span className="expandable-action-btn__label">刷新</span>
          </Button>
        </div>
      </div>
      <ScrollShadow className="bg-surface-secondary min-h-0 flex-1 rounded-xl p-3">
        {state?.error ? <p className="text-danger text-xs">{state.error}</p> : <pre className="font-mono text-xs whitespace-pre-wrap">{state?.diff || '暂无 diff。'}</pre>}
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

function fileExtension(path: string): string {
  return path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || '';
}

function codeLanguage(path: string): string {
  const extension = fileExtension(path);
  const languages: Record<string, string> = {
    c: 'c',
    cpp: 'cpp',
    css: 'css',
    go: 'go',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'jsx',
    mdx: 'mdx',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'shellscript',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'tsx',
    vue: 'vue',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languages[extension] || 'plaintext';
}

function isMarkdownFile(path: string): boolean {
  return ['md', 'markdown', 'mdx'].includes(fileExtension(path));
}

function FilePreview({ file }: { file: { path: string; text?: string; mimeType: string } | null }) {
  if (!file?.text) return <pre className="font-mono text-xs whitespace-pre-wrap">该文件不可作为文本预览。</pre>;
  if (isMarkdownFile(file.path)) return <Markdown>{file.text}</Markdown>;
  return (
    <CodeBlock className="min-w-0">
      <CodeBlock.Header>
        <span className="text-muted text-xs uppercase">{codeLanguage(file.path)}</span>
      </CodeBlock.Header>
      <CodeBlock.Code code={file.text} language={codeLanguage(file.path)} />
    </CodeBlock>
  );
}

function FilesPane({ session, target }: { session: TodeXSession; target?: OpenPanelOptions }) {
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Selection>(new Set());
  const [file, setFile] = useState<{ name: string; path: string; text?: string; mimeType: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const treePanelRef = useRef<PanelImperativeHandle>(null);
  const appliedTargetRef = useRef('');
  const defaultPath = session.activeWorkspace?.path || '';
  const [currentPath, setCurrentPath] = useState(defaultPath);
  const [pathDraft, setPathDraft] = useState(defaultPath);

  useEffect(() => {
    const next = session.activeWorkspace?.path || '';
    setCurrentPath(next);
    setPathDraft(next);
  }, [session.activeWorkspace?.path]);

  const rootName = useMemo(() => {
    if (!currentPath) return 'workspace';
    return currentPath.split(/[/\\]/).filter(Boolean).pop() || currentPath;
  }, [currentPath]);

  const readFile = useCallback(async (path: string) => {
    setSelected(path);
    setError('');
    const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, authToken: session.settings.authToken });
    try {
      setFile(await api.readWorkspaceFile(path));
    } catch (reason) {
      setFile(null);
      setError(reason instanceof Error ? reason.message : '文件读取失败');
    }
  }, [session.settings.authToken, session.settings.serverUrl]);

  const loadDirectory = useCallback(async (directory: string) => {
    setLoading(true);
    setError('');
    const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, authToken: session.settings.authToken });
    try {
      const snapshot = await api.listWorkspaceEntries(directory, '', 100);
      const children = snapshot.entries
        .map((entry) => ({ ...entry, path: absoluteEntryPath(directory, entry.path) }))
        .sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name));
      setEntries((current) => directory === currentPath ? children : replaceFileTreeChildren(current, directory, children));
      setExpandedKeys((current) => new Set([...current, directory]));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '目录读取失败');
    } finally {
      setLoading(false);
    }
  }, [currentPath, session.settings.authToken, session.settings.serverUrl]);

  useEffect(() => {
    setEntries([]);
    setSelected('');
    setFile(null);
    setExpandedKeys(new Set());
    appliedTargetRef.current = '';
    if (currentPath) void loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const handleNavigatePath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setCurrentPath(trimmed);
  };

  useEffect(() => {
    if (!target?.filePath || target.filePath === appliedTargetRef.current) return;
    appliedTargetRef.current = target.filePath;
    void readFile(target.filePath);
  }, [readFile, target?.filePath]);

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

  const renderEntry = (entry: FileTreeEntry): ReactNode => (
    <FileTree.Item
      key={entry.path}
      icon={entry.kind === 'directory' ? <RiFolder3Line /> : <RiFileTextLine />}
      id={entry.path}
      textValue={entry.name}
      title={entry.name}
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
          <TextField aria-label="路径" className="w-full" value={pathDraft} onChange={setPathDraft}>
            <Input placeholder="/path/to/directory..." className="text-xs" />
          </TextField>
        </form>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={!currentPath || loading}
            onPress={() => currentPath && void loadDirectory(currentPath)}
            aria-label="刷新目录"
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              <RiRefreshLine className="size-4" />
            </span>
            <span className="expandable-action-btn__label">刷新</span>
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            onPress={toggleTree}
            aria-label={treeCollapsed ? '显示文件树' : '收起文件树'}
            className="expandable-action-btn"
          >
            <span className="expandable-action-btn__icon">
              {treeCollapsed ? <RiArrowRightDoubleLine className="size-4" /> : <RiArrowLeftDoubleLine className="size-4" />}
            </span>
            <span className="expandable-action-btn__label">{treeCollapsed ? '展开文件树' : '收起文件树'}</span>
          </Button>
        </div>
      </div>
      {error ? <p className="text-danger mb-2 text-xs">{error}</p> : null}
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
            aria-label="工作区文件"
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
            <FileTree.Item key={currentPath || 'root'} icon={<RiFolder3Line />} id={currentPath || 'root'} textValue={rootName} title={rootName}>
              {entries.map(renderEntry)}
            </FileTree.Item>
          </FileTree>
          </ScrollShadow>
        </Resizable.Panel>
        <Resizable.Handle type="pill" withIndicator aria-label="调整文件树宽度" />
        <Resizable.Panel defaultSize="70%" minSize="50%" className="min-h-0">
          <ScrollShadow className="bg-surface-secondary h-full min-h-0 rounded-xl p-3">
            <p className="text-muted mb-2 truncate text-xs">{file?.path || '选择文件预览'}</p>
            {error ? <p className="text-danger text-xs">{error}</p> : <FilePreview file={file} />}
          </ScrollShadow>
        </Resizable.Panel>
      </Resizable>
    </div>
  );
}

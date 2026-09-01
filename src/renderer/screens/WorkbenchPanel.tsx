import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { RiAddLine, RiFileTextLine, RiFolder3Line, RiGlobalLine, RiFocus3Line } from '@remixicon/react';
import { Button, Chip, Dropdown, Input, ScrollShadow, TextField } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { FileTree } from '@heroui-pro/react';
import { CodeBlock } from '@heroui-pro/react/code-block';
import { Markdown } from '@heroui-pro/react/markdown';
import type { TodeXSession } from '../session/useTodeXSession';
import { latencyLabelOf, terminalIdForConversation, terminalStatusLabel } from '../session/helpers';
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
          <Dropdown.Trigger aria-label="新建工作台标签" className="inline-flex size-8 items-center justify-center"><RiAddLine className="size-4" /></Dropdown.Trigger>
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
            {item.type === 'terminal' ? <TerminalPane session={session} terminalId={terminalIdForConversation(conversationId, item.id)} /> : null}
            {item.type === 'browser' ? <BrowserPane workspacePath={session.activeWorkspace?.path} session={session} target={target} /> : null}
            {item.type === 'files' ? <FilesPane session={session} target={target} /> : null}
            {item.type === 'git-diff' ? <GitDiffPane session={session} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalPane({ session, terminalId }: { session: TodeXSession; terminalId: string }) {
  const [input, setInput] = useState('');
  const workspace = session.activeWorkspace;
  const conversation = session.activeConversation;
  const autoStartAttempts = useRef(new Set<string>());
  const manualStopRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const terminalByIdRef = useRef(session.terminalById);
  const terminal = terminalId ? session.terminalById[terminalId] : undefined;
  const lines = terminal?.output ?? [];

  terminalByIdRef.current = session.terminalById;

  useEffect(() => {
    setInput('');
    autoStartAttempts.current.clear();
    manualStopRef.current = false;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [conversation?.id]);

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
        session.startTerminalSession(workspace, conversation, {
          terminalId,
          cwd: workspace.path,
          shell: '',
          rows: 24,
          cols: 80,
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
      session.startTerminalSession(workspace, conversation, {
        terminalId,
        cwd: latest?.cwd || workspace.path,
        shell: latest?.shell || '',
        rows: latest?.rows || 24,
        cols: latest?.cols || 80,
      });
    }, delay);
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [conversation, session.connectionState, session.startTerminalSession, terminal?.status, terminalId, workspace]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111418] text-[#e7eaee]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">终端</p>
          <p className="truncate text-xs text-[#8f98a3]">
            {workspace?.path || '未选择工作区'} · {terminal ? terminalStatusLabel(terminal.status) : '未启动'}
          </p>
        </div>
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
          >
            停止
          </Button>
        </div>
      </div>
      <ScrollShadow className="min-h-0 flex-1 px-4 py-3">
        <div className="font-mono text-xs leading-5 text-[#d8dee9]">
          {lines.length ? lines.map((entry) => (
            <div
              key={entry.id}
              className={entry.kind === 'stderr' || entry.kind === 'error'
                ? 'whitespace-pre-wrap break-words text-red-300'
                : entry.kind === 'input'
                  ? 'whitespace-pre-wrap break-words text-emerald-300'
                  : 'whitespace-pre-wrap break-words'}
            >
              {entry.text}
            </div>
          )) : (
            <div className="text-[#a8b0ba]">{session.connectionState === 'open' ? '$ 正在连接终端...' : '$ 等待连接到 todex-agentd'}</div>
          )}
        </div>
      </ScrollShadow>
      <form
        className="flex gap-2 border-t border-white/10 bg-[#191d22] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || !terminalId || !workspace) return;
          session.sendTerminalInput(terminalId, workspace.tenantId || session.settings.tenantId, `${input}\n`);
          setInput('');
        }}
      >
        <span className="self-center font-mono text-sm text-emerald-400">$</span>
        <TextField aria-label="终端输入" className="min-w-0 flex-1" value={input} onChange={setInput}>
          <Input placeholder="输入命令" className="border-0 bg-transparent font-mono text-[#e7eaee]" />
        </TextField>
        <Button type="submit" isDisabled={!conversation || terminal?.status !== 'running'}>
          发送
        </Button>
      </form>
    </div>
  );
}

function BrowserPane({ workspacePath, session, target }: { workspacePath?: string; session: TodeXSession; target?: OpenPanelOptions }) {
  const [draft, setDraft] = useState('http://127.0.0.1:7345');
  const [url, setUrl] = useState('');
  const [srcDoc, setSrcDoc] = useState('');
  const [error, setError] = useState('');
  const [inspect, setInspect] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const selectedRef = useRef<HTMLElement | null>(null);
  const selectionAnchorRef = useRef<HTMLElement | null>(null);

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
    <div className="flex h-full min-h-0 flex-col p-3">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const target = draft.trim();
          try {
            const parsed = new URL(target);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('仅支持 HTTP 和 HTTPS 地址');
            const host = parsed.hostname.toLowerCase();
            const loopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
            if (!loopback) throw new Error('浏览器预览仅允许访问本机地址');
            setUrl(parsed.toString());
            setSrcDoc('');
            setError('');
          } catch (reason) {
            setUrl('');
            setError(reason instanceof Error ? reason.message : '请输入有效的网址');
          }
        }}
      >
        <TextField aria-label="地址" className="min-w-0 flex-1" value={draft} onChange={setDraft}>
          <Input placeholder="https://" />
        </TextField>
        <Button type="submit" variant="secondary">
          打开
        </Button>
        <Button type="button" isIconOnly variant={inspect ? 'primary' : 'secondary'} aria-label="检查网页元素" onPress={() => { setInspect((current) => { if (!current) { selectedRef.current = null; selectionAnchorRef.current = null; } return !current; }); }}>
          <RiFocus3Line className="size-4" />
        </Button>
      </form>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {url || srcDoc ? (
        <div className="bg-surface min-h-0 flex-1 overflow-hidden rounded-xl">
          <iframe ref={frameRef} title="网页预览" src={url || undefined} srcDoc={srcDoc || undefined} className="size-full border-0" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
        </div>
      ) : (
        <div className="bg-surface-secondary flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl px-6 text-center">
          <RiGlobalLine className="text-muted size-6" />
          <p className="text-sm font-medium">浏览器预览</p>
          <p className="text-muted max-w-xs text-xs">输入地址后由 backend 所在机器请求并返回内容。工作区 {workspacePath || '尚未选择'}。</p>
        </div>
      )}
    </div>
  );
}

function GitDiffPane({ session }: { session: TodeXSession }) {
  const conversation = session.activeConversation;
  const state = conversation ? session.gitDiffByConversation[conversation.id] : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Git Diff</p>
          <p className="text-muted truncate text-xs">{session.activeWorkspace?.path || '未选择工作区'}</p>
        </div>
        <Button size="sm" variant="secondary" isDisabled={!conversation} onPress={() => conversation && session.requestGitDiff(conversation.id)}>刷新</Button>
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
  const appliedTargetRef = useRef('');
  const rootPath = session.activeWorkspace?.path || '';
  const rootName = useMemo(() => session.activeWorkspace?.name || 'workspace', [session.activeWorkspace?.name]);

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
      setEntries((current) => directory === rootPath ? children : replaceFileTreeChildren(current, directory, children));
      setExpandedKeys((current) => new Set([...current, directory]));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '目录读取失败');
    } finally {
      setLoading(false);
    }
  }, [rootPath, session.settings.authToken, session.settings.serverUrl]);

  useEffect(() => {
    setEntries([]);
    setSelected('');
    setFile(null);
    setExpandedKeys(new Set());
    appliedTargetRef.current = '';
    if (rootPath) void loadDirectory(rootPath);
  }, [loadDirectory, rootPath]);

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

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">文件</p>
          <p className="text-muted truncate text-xs">{rootPath || '未选择工作区'}</p>
        </div>
        <Button size="sm" variant="tertiary" isDisabled={!rootPath || loading} onPress={() => rootPath && void loadDirectory(rootPath)}>刷新</Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(180px,0.75fr)_minmax(0,1.25fr)]">
        <ScrollShadow className="bg-surface-secondary min-h-0 rounded-xl p-2">
          <FileTree
            aria-label="工作区文件"
            className="w-full"
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
            <FileTree.Item icon={<RiFolder3Line />} id={rootPath || 'root'} textValue={rootName} title={rootName}>
              {entries.map(renderEntry)}
            </FileTree.Item>
          </FileTree>
        </ScrollShadow>
        <div className="flex min-h-0 flex-col gap-3">
          <ScrollShadow className="bg-surface-secondary min-h-0 flex-[1.5] rounded-xl p-3">
            <p className="text-muted mb-2 truncate text-xs">{file?.path || '选择文件预览'}</p>
            {error ? <p className="text-danger text-xs">{error}</p> : <FilePreview file={file} />}
          </ScrollShadow>
        </div>
      </div>
    </div>
  );
}

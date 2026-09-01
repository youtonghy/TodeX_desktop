import { useEffect, useMemo, useRef, useState } from 'react';
import { RiAddLine, RiFileTextLine, RiFolder3Line, RiGlobalLine } from '@remixicon/react';
import { Button, Chip, Dropdown, Input, ScrollShadow, TextField } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { FileTree } from '@heroui-pro/react';
import type { TodeXSession } from '../session/useTodeXSession';
import { latencyLabelOf, terminalIdForConversation, terminalStatusLabel } from '../session/helpers';
import type { WorkbenchTab } from '../lib/panels';
import { V2ApiClient } from '@todex/protocol/v2';

type Props = {
  session: TodeXSession;
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
};

type WorkbenchItem = { id: string; type: WorkbenchTab; title: string };

const WORKBENCH_LABELS: Record<WorkbenchTab, string> = {
  terminal: '终端',
  browser: '浏览器',
  files: '文件',
  'git-diff': 'Git Diff',
};

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

export function WorkbenchPanel({ session, tab, onTabChange }: Props) {
  const conversationId = session.activeConversation?.id ?? '';
  const [items, setItems] = useState<WorkbenchItem[]>(() => [{ id: 'terminal-1', type: 'terminal', title: '终端 1' }]);
  const [activeId, setActiveId] = useState('terminal-1');

  useEffect(() => {
    const next = items.find((item) => item.type === tab);
    if (next) {
      setActiveId(next.id);
    } else {
      const created = { id: `${tab}-1`, type: tab, title: WORKBENCH_LABELS[tab] };
      setItems((current) => [...current, created]);
      setActiveId(created.id);
    }
  }, [tab]);

  useEffect(() => {
    setItems([{ id: 'terminal-1', type: 'terminal', title: '终端 1' }]);
    setActiveId('terminal-1');
  }, [conversationId]);

  const active = items.find((item) => item.id === activeId) ?? items[0];
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
        {items.map((item) => (
          <div key={item.id} className={item.id === active?.id ? 'h-full' : 'hidden'}>
            {item.type === 'terminal' ? <TerminalPane session={session} terminalId={terminalIdForConversation(conversationId, item.id)} /> : null}
            {item.type === 'browser' ? <BrowserPane workspacePath={session.activeWorkspace?.path} /> : null}
            {item.type === 'files' ? <FilesPane session={session} /> : null}
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

function BrowserPane({ workspacePath }: { workspacePath?: string }) {
  const [draft, setDraft] = useState('http://127.0.0.1:7345');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

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
            setUrl(parsed.toString());
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
      </form>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
      {url ? (
        <div className="bg-surface min-h-0 flex-1 overflow-hidden rounded-xl">
          <iframe title="网页预览" src={url} className="size-full border-0" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" />
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

function FilesPane({ session }: { session: TodeXSession }) {
  const [selected, setSelected] = useState<string>('');
  const [entries, setEntries] = useState<Array<{ name: string; path: string; kind: 'directory' | 'file' }>>([]);
  const [file, setFile] = useState<{ name: string; text?: string; mimeType: string } | null>(null);
  const [error, setError] = useState('');
  const conversation = session.activeConversation;
  const diff = conversation ? session.gitDiffByConversation[conversation.id] : undefined;
  useEffect(() => {
    const path = session.activeWorkspace?.path;
    if (!path) return;
    const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, authToken: session.settings.authToken });
    void api.listWorkspaceDirectories(path).then((snapshot) => setEntries(snapshot.entries)).catch((reason) => setError(reason instanceof Error ? reason.message : '目录读取失败'));
  }, [session.activeWorkspace?.path, session.settings.serverUrl, session.settings.authToken]);
  useEffect(() => {
    if (!selected) return;
    const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, authToken: session.settings.authToken });
    void api.readWorkspaceFile(selected).then(setFile).catch((reason) => setError(reason instanceof Error ? reason.message : '文件读取失败'));
  }, [selected, session.settings.serverUrl, session.settings.authToken]);
  const rootName = useMemo(
    () => session.activeWorkspace?.name || 'workspace',
    [session.activeWorkspace?.name],
  );

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">文件预览</p>
          <p className="text-muted truncate text-xs">{session.activeWorkspace?.path || '未选择工作区'}</p>
        </div>
        <Button
          size="sm"
          variant="tertiary"
          isDisabled={!conversation}
          onPress={() => conversation && session.requestGitDiff(conversation.id)}
        >
          刷新 Diff
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <ScrollShadow className="bg-surface-secondary min-h-0 flex-[1.1] rounded-xl p-2">
          <FileTree
            aria-label="工作区文件"
            className="w-full"
            selectedKeys={selected ? new Set([selected]) : new Set()}
            selectionMode="single"
            onSelectionChange={(keys: Selection) => {
              const next = keys === 'all' ? '' : String([...keys][0] ?? '');
              const entry = entries.find((item) => item.path === next);
              if (entry?.kind === 'file') setSelected(next);
            }}
          >
            <FileTree.Item icon={<RiFolder3Line />} id="root" textValue={rootName} title={rootName}>
              {entries.map((entry) => <FileTree.Item key={entry.path} icon={entry.kind === 'directory' ? <RiFolder3Line /> : <RiFileTextLine />} id={entry.path} textValue={entry.name} title={entry.name} />)}
            </FileTree.Item>
          </FileTree>
        </ScrollShadow>
        <ScrollShadow className="bg-surface-secondary min-h-0 flex-[1.2] rounded-xl p-3">
          <p className="text-muted mb-2 text-xs">{file?.name || '选择文件预览'}</p>
          {error ? <p className="text-danger text-xs">{error}</p> : <pre className="font-mono text-xs whitespace-pre-wrap">{file?.text || '该文件不可作为文本预览。'}</pre>}
        </ScrollShadow>
        <ScrollShadow className="bg-surface-secondary min-h-0 flex-1 rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium">Git Diff</p>
            {diff?.error ? <Chip size="sm" variant="soft">{diff.error}</Chip> : null}
          </div>
          <pre className="text-muted font-mono text-xs whitespace-pre-wrap">
            {diff?.diff || '暂无 diff。后端接口未返回时，这里保持空白占位。'}
          </pre>
        </ScrollShadow>
      </div>
    </div>
  );
}

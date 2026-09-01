import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Folder, Globe, Plus } from '@gravity-ui/icons';
import { Button, Chip, Dropdown, Input, ScrollShadow, TextField } from '@heroui/react';
import type { Selection } from '@heroui/react';
import { FileTree } from '@heroui-pro/react';
import type { TodeXSession } from '../session/useTodeXSession';
import { terminalIdForConversation, terminalStatusLabel } from '../session/helpers';
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
          <Dropdown.Trigger aria-label="新建工作台标签" className="inline-flex size-8 items-center justify-center"><Plus className="size-4" /></Dropdown.Trigger>
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
            {item.type === 'browser' ? <BrowserPane workspacePath={session.activeWorkspace?.path} session={session} /> : null}
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
  const terminalByIdRef = useRef(session.terminalById);
  const terminal = terminalId ? session.terminalById[terminalId] : undefined;
  const lines = terminal?.output ?? [];

  terminalByIdRef.current = session.terminalById;

  useEffect(() => {
    setInput('');
    autoStartAttempts.current.clear();
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111418] text-[#e7eaee]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">终端</p>
          <p className="truncate text-xs text-[#8f98a3]">
            {workspace?.path || '未选择工作区'} · {terminal ? terminalStatusLabel(terminal.status) : '未启动'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {terminal && (terminal.status === 'error' || terminal.status === 'exited') ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                if (!workspace || !conversation || !terminalId) return;
                session.startTerminalSession(workspace, conversation, {
                  terminalId,
                  cwd: terminal.cwd || workspace.path,
                  shell: terminal.shell,
                  rows: terminal.rows,
                  cols: terminal.cols,
                });
              }}
            >
              重连
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="danger-soft"
            isDisabled={!terminalId || !terminal || terminal.status === 'exited'}
            onPress={() => {
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
        <pre className="font-mono text-xs leading-5 whitespace-pre-wrap text-[#d8dee9]">
          {lines.length
            ? lines.map((entry) => entry.text.endsWith('\n') ? entry.text : `${entry.text}\n`).join('')
            : session.connectionState === 'open'
              ? '$ 正在连接终端...'
              : '$ 等待连接到 todex-agentd'}
        </pre>
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

function BrowserPane({ workspacePath, session }: { workspacePath?: string; session: TodeXSession }) {
  const [draft, setDraft] = useState('http://127.0.0.1:7345');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<{ status: number; contentType: string; body: string } | null>(null);
  const [error, setError] = useState('');

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const target = draft.trim();
          setUrl(target); setError(''); setResult(null);
          const api = new V2ApiClient({ serverUrl: session.settings.serverUrl, authToken: session.settings.authToken });
          void api.fetchBrowser(target).then(setResult).catch((reason) => setError(reason instanceof Error ? reason.message : '浏览器请求失败'));
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
      {url && result ? (
        <div className="bg-surface min-h-0 flex-1 overflow-auto rounded-xl p-3">
          <p className="text-muted mb-2 text-xs">{result.status} · {result.contentType} · 后端代理</p>
          <pre className="font-mono text-xs whitespace-pre-wrap">{result.body}</pre>
        </div>
      ) : (
        <div className="bg-surface-secondary flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl px-6 text-center">
          <Globe className="text-muted size-6" />
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
            <FileTree.Item icon={<Folder />} id="root" textValue={rootName} title={rootName}>
              {entries.map((entry) => <FileTree.Item key={entry.path} icon={entry.kind === 'directory' ? <Folder /> : <FileText />} id={entry.path} textValue={entry.name} title={entry.name} />)}
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

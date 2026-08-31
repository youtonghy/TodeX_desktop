import { useMemo, useState } from 'react';
import { Code, FileText, Folder, Globe } from '@gravity-ui/icons';
import { Button, Chip, Input, ScrollShadow, Tabs, TextField } from '@heroui/react';
import { FileTree } from '@heroui-pro/react';
import type { TodeXSession } from '../session/useTodeXSession';
import { terminalIdForConversation, terminalStatusLabel } from '../session/helpers';
import type { WorkbenchTab } from '../lib/panels';

type Props = {
  session: TodeXSession;
  tab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        className="flex h-full min-h-0 flex-col"
        selectedKey={tab}
        variant="secondary"
        onSelectionChange={(key) => {
          if (key === 'terminal' || key === 'browser' || key === 'files') {
            onTabChange(key);
          }
        }}
      >
        <Tabs.ListContainer className="px-3 pt-3">
          <Tabs.List aria-label="右侧工作台">
            <Tabs.Tab id="terminal">
              终端
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="browser">
              浏览器
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="files">
              文件
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0" id="terminal">
          <TerminalPane session={session} />
        </Tabs.Panel>
        <Tabs.Panel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0" id="browser">
          <BrowserPane workspacePath={session.activeWorkspace?.path} />
        </Tabs.Panel>
        <Tabs.Panel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0" id="files">
          <FilesPane session={session} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

function TerminalPane({ session }: { session: TodeXSession }) {
  const [input, setInput] = useState('');
  const workspace = session.activeWorkspace;
  const conversation = session.activeConversation;
  const terminalId = conversation ? terminalIdForConversation(conversation.id) : '';
  const terminal = terminalId ? session.terminalById[terminalId] : undefined;
  const lines = terminal?.output ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">终端</p>
          <p className="text-muted truncate text-xs">
            {workspace?.path || '未选择工作区'} · {terminal ? terminalStatusLabel(terminal.status) : '未启动'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={!workspace || !conversation}
            onPress={() => {
              if (workspace && conversation) {
                session.startTerminalSession(workspace, conversation, {
                  cwd: workspace.path,
                  shell: '',
                  rows: 24,
                  cols: 80,
                });
              }
            }}
          >
            启动
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            isDisabled={!terminalId}
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
      <ScrollShadow className="bg-surface-secondary min-h-0 flex-1 rounded-xl p-3">
        <pre className="text-muted font-mono text-xs whitespace-pre-wrap">
          {lines.length
            ? lines.map((entry) => `${entry.kind}: ${entry.text}`).join('\n')
            : `$ 等待连接到 todex-agentd\n后端终端接口未就绪时，这里只展示布局。`}
        </pre>
      </ScrollShadow>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || !terminalId || !workspace) return;
          session.sendTerminalInput(terminalId, workspace.tenantId || session.settings.tenantId, `${input}\n`);
          setInput('');
        }}
      >
        <TextField aria-label="终端输入" className="min-w-0 flex-1" value={input} onChange={setInput}>
          <Input placeholder="输入命令" />
        </TextField>
        <Button type="submit" isDisabled={!conversation}>
          发送
        </Button>
      </form>
    </div>
  );
}

function BrowserPane({ workspacePath }: { workspacePath?: string }) {
  const [draft, setDraft] = useState('http://127.0.0.1:7345');
  const [url, setUrl] = useState('');

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <form
        className="mb-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setUrl(draft.trim());
        }}
      >
        <TextField aria-label="地址" className="min-w-0 flex-1" value={draft} onChange={setDraft}>
          <Input placeholder="https://" />
        </TextField>
        <Button type="submit" variant="secondary">
          打开
        </Button>
      </form>
      {url ? (
        <iframe
          className="bg-surface min-h-0 flex-1 rounded-xl"
          sandbox="allow-scripts allow-same-origin allow-forms"
          src={url}
          title="工作区浏览器预览"
        />
      ) : (
        <div className="bg-surface-secondary flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl px-6 text-center">
          <Globe className="text-muted size-6" />
          <p className="text-sm font-medium">浏览器预览</p>
          <p className="text-muted max-w-xs text-xs">
            输入地址后在此预览页面。工作区 {workspacePath || '尚未选择'}，后端内嵌浏览接口未接入前仅作前端占位。
          </p>
        </div>
      )}
    </div>
  );
}

function FilesPane({ session }: { session: TodeXSession }) {
  const [selected, setSelected] = useState<string>('readme');
  const conversation = session.activeConversation;
  const diff = conversation ? session.gitDiffByConversation[conversation.id] : undefined;
  const preview = PLACEHOLDER_FILES[selected] ?? PLACEHOLDER_FILES.readme;
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
            defaultExpandedKeys={['src']}
            selectedKeys={new Set([selected])}
            selectionMode="single"
            onSelectionChange={(keys) => {
              const next = keys === 'all' ? 'readme' : String([...keys][0] ?? 'readme');
              setSelected(next);
            }}
          >
            <FileTree.Item icon={<Folder />} id="src" textValue="src" title={rootName}>
              <FileTree.Item icon={<FileText />} id="readme" textValue="README.md" title="README.md" />
              <FileTree.Item icon={<FileText />} id="agent" textValue="AGENTS.md" title="AGENTS.md" />
              <FileTree.Item icon={<Code />} id="package" textValue="package.json" title="package.json" />
            </FileTree.Item>
          </FileTree>
        </ScrollShadow>
        <ScrollShadow className="bg-surface-secondary min-h-0 flex-[1.2] rounded-xl p-3">
          <p className="text-muted mb-2 text-xs">{preview.title}</p>
          <pre className="font-mono text-xs whitespace-pre-wrap">{preview.body}</pre>
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

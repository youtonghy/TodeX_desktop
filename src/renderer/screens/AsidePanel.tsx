import { useState } from 'react';
import { Button, Card, Input, Label, ScrollShadow, Switch, TextArea, TextField } from '@heroui/react';
import type { ProviderKind } from '@todex/protocol/v2';
import type { DesktopPanel } from '../lib/panels';
import type { TodeXSession } from '../session/useTodeXSession';
import {
  EXPERIMENTAL_FEATURES,
  SLASH_COMMANDS,
  SLASH_COMMAND_CATEGORY_LABELS,
  SLASH_COMMAND_CATEGORY_ORDER,
  terminalIdForConversation,
  terminalStatusLabel,
} from '../session/helpers';
import { CapabilitiesPanel } from './CapabilitiesPanel';

type Props = {
  session: TodeXSession;
  panel: DesktopPanel;
  slashCommand?: string;
  onBack?: () => void;
};

export function AsidePanel({ session, panel, slashCommand, onBack }: Props) {
  const conversation = session.activeConversation;
  const workspace = session.activeWorkspace;
  const back = onBack ? (
    <div className="px-4 pt-3">
      <Button size="sm" variant="tertiary" onPress={onBack}>返回工作台</Button>
    </div>
  ) : null;

  if (panel === 'settings') {
    return null;
  }

  if (panel === 'capabilities') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {back}
        <CapabilitiesPanel
        workspacePath={workspace?.path ?? session.settings.defaultWorkspacePath}
        providers={session.v2Providers}
        catalogs={session.capabilityCatalogs}
        onRefresh={(provider: ProviderKind) => void session.refreshCapabilityCatalog(provider)}
      />
      </div>
    );
  }

  if (panel === 'experimental') {
    return (
      <div className="flex flex-col gap-4 p-5">
        {back}
        <h2 className="text-lg font-semibold">实验功能</h2>
        {EXPERIMENTAL_FEATURES.map((feature) => (
          <Switch
            key={feature.id}
            isSelected={session.experimentalFeatures[feature.id]}
            onChange={(selected) => session.setExperimentalFeatures((current) => ({ ...current, [feature.id]: selected }))}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <div>
                <p className="text-sm font-medium">{feature.title}</p>
                <p className="text-muted text-xs">{feature.description}</p>
              </div>
            </Switch.Content>
          </Switch>
        ))}
      </div>
    );
  }

  if (panel === 'git-diff') {
    const state = conversation ? session.gitDiffByConversation[conversation.id] : undefined;
    return (
      <div className="flex h-full min-h-0 flex-col p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Git Diff</h2>
          <Button size="sm" variant="secondary" isDisabled={!conversation} onPress={() => conversation && session.requestGitDiff(conversation.id)}>
            刷新
          </Button>
        </div>
        <ScrollShadow className="min-h-0 flex-1">
          <pre className="text-xs whitespace-pre-wrap">{state?.diff || state?.error || '暂无 diff。'}</pre>
        </ScrollShadow>
        {state?.diff ? (
          <Button className="mt-3" variant="tertiary" onPress={() => void navigator.clipboard.writeText(state.diff)}>复制</Button>
        ) : null}
      </div>
    );
  }

  if (panel === 'terminal' && workspace && conversation) {
    const terminalId = terminalIdForConversation(conversation.id);
    return (
      <TerminalAside session={session} terminalId={terminalId} />
    );
  }

  if (panel === 'slash-commands') {
    return (
      <div className="flex h-full min-h-0 flex-col p-5">
        {back}
        <h2 className="text-lg font-semibold">斜杠命令</h2>
        <ScrollShadow className="mt-3 min-h-0 flex-1">
          {SLASH_COMMAND_CATEGORY_ORDER.map((category) => {
            const commands = SLASH_COMMANDS.filter((item) => item.category === category);
            if (!commands.length) return null;
            return (
              <div key={category} className="mb-4">
                <p className="text-muted mb-2 text-xs font-semibold">{SLASH_COMMAND_CATEGORY_LABELS[category]}</p>
                <div className="flex flex-col gap-1">
                  {commands.map((item) => (
                    <Button
                      key={item.command}
                      variant="ghost"
                      className="justify-start"
                      onPress={() => {
                        if (!workspace || !conversation) return;
                        session.openSlashCommandActionPage(workspace, conversation, item.command);
                      }}
                    >
                      <span className="font-medium">{item.command}</span>
                      <span className="text-muted ml-2 text-xs">{item.description}</span>
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </ScrollShadow>
      </div>
    );
  }

  if (panel === 'slash-action' && slashCommand && workspace && conversation) {
    return (
      <SlashActionAside
        session={session}
        command={slashCommand}
        conversationId={conversation.id}
      />
    );
  }

  if (panel === 'v2') {
    return (
      <div className="flex flex-col gap-3 p-5">
        {back}
        <h2 className="text-lg font-semibold">TodeX 2.0</h2>
        {session.v2Providers.map((provider) => (
          <Card key={provider.id} className="p-3">
            <p className="font-medium">{provider.displayName}</p>
            <p className="text-muted text-xs">{provider.available ? '可用' : provider.unavailableReason || '不可用'}</p>
          </Card>
        ))}
        {session.v2Conversations.map((item) => (
          <Card key={item.id} className="p-3">
            <p className="text-sm font-medium">{item.title || item.id}</p>
            <p className="text-muted text-xs">{item.provider} · {item.status}</p>
          </Card>
        ))}
      </div>
    );
  }

  return null;
}

function TerminalAside({ session, terminalId }: { session: TodeXSession; terminalId: string }) {
  const [input, setInput] = useState('');
  const workspace = session.activeWorkspace;
  const conversation = session.activeConversation;
  const terminal = session.terminalById[terminalId];
  if (!workspace || !conversation) {
    return <p className="text-muted p-5 text-sm">请先选择对话。</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">终端</h2>
          <p className="text-muted text-xs">{terminal ? terminalStatusLabel(terminal.status) : '未启动'}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onPress={() => session.startTerminalSession(workspace, conversation, { cwd: workspace.path, shell: '', rows: 24, cols: 80 })}>启动</Button>
          <Button size="sm" variant="danger-soft" onPress={() => session.stopTerminalSession(terminalId, workspace.tenantId || session.settings.tenantId)}>停止</Button>
        </div>
      </div>
      <ScrollShadow className="bg-surface-secondary min-h-0 flex-1 rounded-xl p-3">
        <pre className="font-mono text-xs whitespace-pre-wrap">
          {(terminal?.output ?? []).map((entry) => `${entry.kind}: ${entry.text}`).join('\n') || '暂无输出'}
        </pre>
      </ScrollShadow>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim()) return;
          session.sendTerminalInput(terminalId, workspace.tenantId || session.settings.tenantId, `${input}\n`);
          setInput('');
        }}
      >
        <TextField className="flex-1" value={input} onChange={setInput}>
          <Input placeholder="输入命令" />
        </TextField>
        <Button type="submit">发送</Button>
      </form>
    </div>
  );
}

function SlashActionAside({ session, command, conversationId }: { session: TodeXSession; command: string; conversationId: string }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-semibold">{command}</h2>
      <p className="text-muted text-sm">确认后将作为斜杠命令发送到当前对话。</p>
      <TextField value={value} onChange={setValue}>
        <Label>参数</Label>
        <TextArea className="w-full" rows={4} />
      </TextField>
      <Button onPress={() => session.sendSlashCommand(`${command} ${value}`.trim(), conversationId)}>执行</Button>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Input, Label, ScrollShadow, Switch, TextArea, TextField } from '@heroui/react';
import type { ProviderKind } from '@todex/protocol/v2';
import type { DesktopPanel } from '../lib/panels';
import type { TodeXSession } from '../session/useTodeXSession';
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  EXPERIMENTAL_FEATURES,
  SLASH_COMMANDS,
  SLASH_COMMAND_CATEGORY_LABELS,
  SLASH_COMMAND_CATEGORY_ORDER,
  terminalIdForConversation,
  terminalStatusLabel,
} from '../session/helpers';
import { XtermTerminal } from '../components/XtermTerminal';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { useT } from '../i18n';

type Props = {
  session: TodeXSession;
  panel: DesktopPanel;
  slashCommand?: string;
  onBack?: () => void;
};

export function AsidePanel({ session, panel, slashCommand, onBack }: Props) {
  const t = useT();
  const conversation = session.activeConversation;
  const workspace = session.activeWorkspace;
  const back = onBack ? (
    <div className="px-4 pt-3">
      <Button size="sm" variant="tertiary" onPress={onBack}>{t('aside.back')}</Button>
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
        conversationId={conversation?.id}
        selectedSkills={conversation ? session.selectedSkills[conversation.id] ?? [] : []}
        canInvoke={Boolean(conversation?.v2ConversationId)}
        onToggleSkill={(skill, provider) => {
          if (conversation) {
            session.toggleCatalogSkill(conversation.id, skill, provider);
          }
        }}
        onPreviewSkill={(skill, provider) => session.previewSkillResource(provider, skill.resourceId)}
        onRefreshMcp={(resourceId) => {
          if (conversation) {
            session.refreshMcpServer(conversation.id, resourceId);
          }
        }}
        onCallMcp={(resourceId, toolName) => {
          if (conversation) {
            session.callMcpTool(conversation.id, resourceId, toolName);
          }
        }}
      />
      </div>
    );
  }

  if (panel === 'experimental') {
    return (
      <div className="flex flex-col gap-4 p-5">
        {back}
        <h2 className="text-lg font-semibold">{t('aside.experimental')}</h2>
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
            {t('aside.refresh')}
          </Button>
        </div>
        <ScrollShadow className="min-h-0 flex-1">
          <pre className="text-xs whitespace-pre-wrap">{state?.diff || state?.error || t('aside.noDiff')}</pre>
        </ScrollShadow>
        {state?.diff ? (
          <Button className="mt-3" variant="tertiary" onPress={() => void navigator.clipboard.writeText(state.diff)}>{t('common.copy')}</Button>
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
        <h2 className="text-lg font-semibold">{t('aside.slashCommands')}</h2>
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
            <p className="text-muted text-xs">{provider.available ? t('aside.available') : provider.unavailableReason || t('aside.unavailable')}</p>
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
  const t = useT();
  const workspace = session.activeWorkspace;
  const conversation = session.activeConversation;
  const terminal = session.terminalById[terminalId];
  const terminalByIdRef = useRef(session.terminalById);
  const terminalSizeRef = useRef({ rows: DEFAULT_TERMINAL_ROWS, cols: DEFAULT_TERMINAL_COLS });

  terminalByIdRef.current = session.terminalById;

  useEffect(() => {
    if (!terminal) return;
    terminalSizeRef.current = { rows: terminal.rows, cols: terminal.cols };
  }, [terminal?.cols, terminal?.rows]);

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

  if (!workspace || !conversation) {
    return <p className="text-muted p-5 text-sm">{t('aside.selectConversation')}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('aside.terminal')}</h2>
          <p className="text-muted text-xs">{terminal ? terminalStatusLabel(terminal.status) : t('aside.terminalNotStarted')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            isDisabled={terminal?.status === 'running' || terminal?.status === 'starting'}
            onPress={() => {
              const size = terminalSizeRef.current;
              session.startTerminalSession(workspace, conversation, {
                cwd: workspace.path,
                shell: '',
                rows: size.rows,
                cols: size.cols,
              });
            }}
          >
            {t('aside.terminalStart')}
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            isDisabled={!terminal || terminal.status === 'idle' || terminal.status === 'exited'}
            onPress={() => session.stopTerminalSession(terminalId, workspace.tenantId || session.settings.tenantId)}
          >
            {t('aside.terminalStop')}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-eclipse">
        <XtermTerminal
          entries={terminal?.output ?? []}
          isActive
          isDisabled={terminal?.status !== 'running'}
          onData={handleTerminalData}
          onResize={handleTerminalResize}
        />
      </div>
    </div>
  );
}

function SlashActionAside({ session, command, conversationId }: { session: TodeXSession; command: string; conversationId: string }) {
  const t = useT();
  const [value, setValue] = useState('');
  const subagents = command === '/subagents' ? session.subagentsByConversation[conversationId] ?? [] : [];
  const subagentLabels = { queued: t('aside.subagentQueued'), running: t('aside.subagentRunning'), completed: t('aside.subagentCompleted'), failed: t('aside.subagentFailed'), cancelled: t('aside.subagentCancelled') };
  const memoryEntries = session.memoryEntriesByConversation[conversationId] ?? [];
  if (command === '/memory') {
    return <div className="flex h-full flex-col gap-3 p-5"><h2 className="text-lg font-semibold">{t('aside.memoryTitle')}</h2><p className="text-muted text-sm">{t('aside.memoryHint')}</p><ScrollShadow className="min-h-0 flex-1 overflow-y-auto">{memoryEntries.length ? memoryEntries.map(entry => <Card key={entry.id} className="mb-2 p-3"><p className="whitespace-pre-wrap text-sm">{entry.content}</p><p className="text-muted mt-2 text-xs">{entry.scope === 'user' ? t('aside.memoryUser') : entry.scope === 'workspace' ? t('aside.memoryWorkspace') : t('aside.memoryConversation')}</p></Card>) : <p className="text-muted text-sm">{t('aside.memoryEmpty')}</p>}</ScrollShadow></div>;
  }
  if (command === '/subagents') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 p-5">
        <h2 className="text-lg font-semibold">Subagents</h2>
        <ScrollShadow className="min-h-0 flex-1">
          {subagents.length ? subagents.map((run) => (
            <Card key={run.id} className="mb-2 p-3">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{run.title}</span><span className="text-muted text-xs">{subagentLabels[run.status]}</span></div>
              {run.task ? <p className="text-muted mt-1 text-xs whitespace-pre-wrap">{run.task}</p> : null}
              {run.result ? <p className="mt-2 text-sm whitespace-pre-wrap">{run.result}</p> : null}
              {run.error ? <p className="mt-2 text-danger text-xs">{run.error}</p> : null}
            </Card>
          )) : <p className="text-muted text-sm">{t('aside.subagentEmpty')}</p>}
        </ScrollShadow>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-semibold">{command}</h2>
      <p className="text-muted text-sm">{t('aside.slashConfirm')}</p>
      <TextField value={value} onChange={setValue}>
        <Label>{t('aside.slashArgs')}</Label>
        <TextArea className="w-full" rows={4} />
      </TextField>
      <Button onPress={() => session.sendSlashCommand(`${command} ${value}`.trim(), conversationId)}>{t('aside.slashRun')}</Button>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Switch } from '@/components/base/switch/switch';
import { Textarea } from '@/components/base/textarea/textarea';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { GitDiffText } from '../components/GitDiffText';
import { useT } from '../i18n';
import { cx } from '@/utils/cx';

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
      <Button size="small" variant="secondary" onClick={onBack}>{t('aside.back')}</Button>
    </div>
  ) : null;

  if (panel === 'settings') {
    return null;
  }

  if (panel === 'experimental') {
    return (
      <div className="flex flex-col gap-4 p-5">
        {back}
        <h2 className="text-title-3-semibold text-text-primary">{t('aside.experimental')}</h2>
        {EXPERIMENTAL_FEATURES.map((feature) => (
          <Switch
            key={feature.id}
            className="items-start gap-3"
            isSelected={session.experimentalFeatures[feature.id]}
            onChange={(selected) => session.setExperimentalFeatures((current) => ({ ...current, [feature.id]: selected }))}
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-body-medium text-text-primary">{feature.title}</span>
              <span className="text-caption-1-regular text-text-secondary">{feature.description}</span>
            </span>
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
          <h2 className="text-title-3-semibold text-text-primary">Git Diff</h2>
          <Button size="small" variant="secondary" disabled={!conversation} onClick={() => conversation && session.requestGitDiff(conversation.id, session.selectedGitRepoByWorkspace[conversation.workspaceId] || '')}>
            {t('aside.refresh')}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1" surface="secondary">
          <GitDiffText state={state} />
        </ScrollArea>
        {state?.diff ? (
          <Button className="mt-3" variant="secondary" onClick={() => void navigator.clipboard.writeText(state.diff)}>{t('common.copy')}</Button>
        ) : null}
      </div>
    );
  }

  if (panel === 'slash-commands') {
    return (
      <div className="flex h-full min-h-0 flex-col p-5">
        {back}
        <h2 className="text-title-3-semibold text-text-primary">{t('aside.slashCommands')}</h2>
        <ScrollArea className="mt-3 min-h-0 flex-1" surface="secondary">
          {SLASH_COMMAND_CATEGORY_ORDER.map((category) => {
            const commands = SLASH_COMMANDS.filter((item) => item.category === category);
            if (!commands.length) return null;
            return (
              <div key={category} className="mb-4">
                <p className="mb-2 text-caption-1-semibold text-text-secondary">{SLASH_COMMAND_CATEGORY_LABELS[category]}</p>
                <div className="flex flex-col gap-1">
                  {commands.map((item) => (
                    <button
                      key={item.command}
                      type="button"
                      className={cx(
                        'flex w-full cursor-pointer items-baseline gap-2 rounded-2lg px-2 py-1.5 text-start',
                        'outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring',
                      )}
                      onClick={() => {
                        if (!workspace || !conversation) return;
                        session.openSlashCommandActionPage(workspace, conversation, item.command);
                      }}
                    >
                      <span className="text-body-medium text-text-primary">{item.command}</span>
                      <span className="min-w-0 truncate text-caption-1-regular text-text-secondary">{item.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </ScrollArea>
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
        <h2 className="text-title-3-semibold text-text-primary">TodeX 2.0</h2>
        {session.v2Providers.map((provider) => (
          <Card key={provider.id} variant="secondary" className="gap-0.5 p-3">
            <p className="text-headline-medium text-text-primary">{provider.displayName}</p>
            <p className="text-caption-1-regular text-text-secondary">{provider.available ? t('aside.available') : provider.unavailableReason || t('aside.unavailable')}</p>
          </Card>
        ))}
        {session.v2Conversations.map((item) => (
          <Card key={item.id} variant="secondary" className="gap-0.5 p-3">
            <p className="text-body-medium text-text-primary">{item.title || item.id}</p>
            <p className="text-caption-1-regular text-text-secondary">{item.provider} · {item.status}</p>
          </Card>
        ))}
      </div>
    );
  }

  return null;
}

function SlashActionAside({ session, command, conversationId }: { session: TodeXSession; command: string; conversationId: string }) {
  const t = useT();
  const [value, setValue] = useState('');
  const memoryEntries = session.memoryEntriesByConversation[conversationId] ?? [];
  if (command === '/memory') {
    return <div className="flex h-full flex-col gap-3 p-5"><h2 className="text-title-3-semibold text-text-primary">{t('aside.memoryTitle')}</h2><p className="text-body-regular text-text-secondary">{t('aside.memoryHint')}</p><ScrollArea className="min-h-0 flex-1" surface="secondary">{memoryEntries.length ? memoryEntries.map(entry => <Card key={entry.id} variant="secondary" className="mb-2 gap-2 p-3"><p className="whitespace-pre-wrap text-body-regular text-text-primary">{entry.content}</p><p className="text-caption-1-regular text-text-secondary">{entry.scope === 'user' ? t('aside.memoryUser') : entry.scope === 'workspace' ? t('aside.memoryWorkspace') : t('aside.memoryConversation')}</p></Card>) : <p className="text-body-regular text-text-secondary">{t('aside.memoryEmpty')}</p>}</ScrollArea></div>;
  }
  return (
    <div className="flex flex-col gap-4 p-5">
      <h2 className="text-title-3-semibold text-text-primary">{command}</h2>
      <p className="text-body-regular text-text-secondary">{t('aside.slashConfirm')}</p>
      <Textarea label={t('aside.slashArgs')} value={value} onChange={setValue} rows={4} />
      <Button onClick={() => session.sendSlashCommand(`${command} ${value}`.trim(), conversationId)}>{t('aside.slashRun')}</Button>
    </div>
  );
}

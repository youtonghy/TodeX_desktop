import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Chip, Popover } from '@heroui/react';
import { RiMoreLine } from '@remixicon/react';
import { providerDisplayName } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { isV2Conversation } from '../session/helpers';
import { ProviderIcon } from './ProviderIcon';
import { GitStatusDisplay, useConversationGitStatus } from './GitStatusIndicator';

type Props = { session: TodeXSession; title: string; gitOpen: boolean; onOpenGit: () => void };

export function ConversationHeaderDetails({ session, title, gitOpen, onOpenGit }: Props) {
  const availableRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(true);
  const [open, setOpen] = useState(false);
  const git = useConversationGitStatus(session, gitOpen);
  const conversation = session.activeConversation;
  useLayoutEffect(() => {
    const available = availableRef.current;
    const measure = measureRef.current;
    if (!available || !measure) return;
    const update = () => setCompact(available.clientWidth < measure.scrollWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(available);
    observer.observe(measure);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { if (!compact) setOpen(false); }, [compact]);
  const agent = conversation ? <Chip size="sm" variant="soft" className="shrink-0 whitespace-nowrap">
    <ProviderIcon provider={isV2Conversation(conversation) ? conversation.provider : 'codex'} />
    {isV2Conversation(conversation) ? providerDisplayName(conversation.provider || '', 'Agent') : '历史 Codex'}
  </Chip> : null;
  const inline = <>
    <span className="max-w-64 shrink-0 truncate text-sm font-medium">{title}</span>
    {agent}
    <GitStatusDisplay state={git} onOpenGit={onOpenGit} wrap={false} />
  </>;
  return <div ref={availableRef} className="relative min-w-0 flex-1 overflow-hidden" data-testid="header-details" data-compact={compact}>
    {/* Measure presentation only; Git is fetched once above, even when collapsed. */}
    <div ref={measureRef} inert aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 flex w-max items-center gap-3">{inline}</div>
    {compact ? <Popover isOpen={open} onOpenChange={setOpen}>
      <Button isIconOnly size="sm" variant="ghost" aria-label="对话与 Git 信息" aria-expanded={open}><RiMoreLine className="size-4" /></Button>
      <Popover.Content placement="bottom start" className="w-[min(24rem,calc(100vw-2rem))]">
        <Popover.Dialog className="space-y-3 p-4">
          <Popover.Heading className="break-words text-sm font-semibold">{title}</Popover.Heading>
          {agent}
          {git.workspace ? <div className="space-y-1 text-xs"><p className="font-medium">{git.workspace.name}</p><p className="break-all text-muted">{git.workspace.path}</p></div> : null}
          <GitStatusDisplay state={git} onOpenGit={() => { setOpen(false); onOpenGit(); }} />
        </Popover.Dialog>
      </Popover.Content>
    </Popover> : <div className="flex w-max items-center gap-3">{inline}</div>}
  </div>;
}

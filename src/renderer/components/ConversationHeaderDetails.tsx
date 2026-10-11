import { useLayoutEffect, useRef, useState } from 'react';
import { RiMoreLine } from '@remixicon/react';
import { Heading } from 'react-aria-components';
import { providerDisplayName } from '@todex/protocol/v2';
import { Chip } from '@/components/base/badges/chip';
import { Dropdown, DropdownPopover, DropdownTrigger } from '@/components/base/dropdown/dropdown';
import { cx } from '@/utils/cx';
import type { TodeXSession } from '../session/useTodeXSession';
import { isV2Conversation } from '../session/helpers';
import { ProviderIcon } from './ProviderIcon';
import { GitStatusDisplay, useConversationGitStatus } from './GitStatusIndicator';
import { useT } from '../i18n';

type Props = { session: TodeXSession; title: string; gitOpen: boolean; onOpenGit: () => void };

export function ConversationHeaderDetails({ session, title, gitOpen, onOpenGit }: Props) {
  const t = useT();
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
  const agent = conversation ? <Chip variant="caption" color="neutral" className="shrink-0 gap-1 whitespace-nowrap">
    <ProviderIcon className="size-3.5" provider={isV2Conversation(conversation) ? conversation.provider : 'codex'} />
    {isV2Conversation(conversation) ? providerDisplayName(conversation.provider || '', 'Agent') : t('header.legacyCodex')}
  </Chip> : null;
  const inline = <>
    <span className="max-w-64 shrink-0 truncate text-body-medium text-text-primary">{title}</span>
    {agent}
    <GitStatusDisplay state={git} onOpenGit={onOpenGit} wrap={false} />
  </>;
  return <div ref={availableRef} className="relative min-w-0 flex-1 overflow-hidden" data-testid="header-details" data-compact={compact}>
    {/* Measure presentation only; Git is fetched once above, even when collapsed. */}
    <div ref={measureRef} inert aria-hidden="true" className="pointer-events-none invisible absolute top-0 start-0 flex w-max items-center gap-3">{inline}</div>
    {compact ? <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        aria-label={t('header.details')}
        className={cx(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary',
          'transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-foreground-icon-primary',
          'data-[pressed]:bg-background-tertiary-default',
          open && 'bg-background-secondary-hover text-foreground-icon-primary',
        )}
      >
        <RiMoreLine aria-hidden className="size-[18px]" />
      </DropdownTrigger>
      <DropdownPopover aria-label={t('header.details')} placement="bottom start" className="w-[min(24rem,calc(100vw-2rem))]" dialogClassName="gap-3 p-1.5">
        <Heading slot="title" className="break-words text-body-semibold text-text-primary">{title}</Heading>
        {agent ? <div className="flex">{agent}</div> : null}
        {git.workspace ? <div className="space-y-1">
          <p className="text-caption-1-medium text-text-primary">{git.workspace.name}</p>
          <p className="break-all text-caption-1-regular text-text-secondary">{git.workspace.path}</p>
        </div> : null}
        <GitStatusDisplay state={git} onOpenGit={() => { setOpen(false); onOpenGit(); }} />
      </DropdownPopover>
    </Dropdown> : <div className="flex w-max items-center gap-3">{inline}</div>}
  </div>;
}

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RiArrowDownLine, RiDeleteBinLine, RiFileCopyLine, RiShieldKeyholeLine } from '@remixicon/react';
import {
  isSshFailureKind,
  isSshLoginPending,
  summarizeAgentOutputRedactions,
  type AgentOutputFilterCategory,
  type AgentOutputRedactions,
  type SshExecLogin,
  type SshExecRun,
} from '@todex/protocol/ssh';
import { SSH_FAILURE_HINT_KEYS, SSH_FAILURE_LABEL_KEYS } from './sshShared';
import {
  clearSshExecView,
  countLines,
  formatSshExecDuration,
  formatSshExecTime,
  isSshExecFailed,
  sshExecTranscript,
  sshExecTurns,
  stripAnsi,
  useSshExecClear,
  visibleSshExecs,
} from '../../session/sshExecTabs';
import { t, useT, type MessageKey } from '../../i18n';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { LinkButton } from '@/components/base/buttons/link-button';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Switch } from '@/components/base/switch/switch';
import { IconAction } from '@/components/ui/icon-action';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';

type ChipColor = 'neutral' | 'blue' | 'lime' | 'yellow' | 'rose';

/** Lines shown before an output block collapses behind "show all". */
export const SSH_EXEC_COLLAPSED_LINES = 12;
/** Distance from the bottom (px) that still counts as following the log. */
const FOLLOW_THRESHOLD = 40;
// Opaque, so the collapse fade can blend into it.
const OUTPUT_BG = 'bg-background-secondary-default';
const OUTPUT_FADE = 'to-background-secondary-default';
/** Host filter key for "all hosts"; the space keeps it apart from any host
 * name or ssh_config alias. */
const ALL_HOSTS = 'all hosts';

function copyText(text: string, success: string) {
  void navigator.clipboard.writeText(text)
    .then(() => toast.success(success))
    .catch(() => toast.danger(t('sshExec.copyFailed')));
}

function runStatus(run: SshExecRun): { label: string; color: ChipColor; hint: string } {
  if (run.status === 'running') return { label: t('sshExec.running'), color: 'blue', hint: '' };
  if (run.status === 'cancelled' || run.failure === 'cancelled') return { label: t('sshExec.cancelled'), color: 'neutral', hint: '' };
  if (run.status === 'failed') {
    const kind = isSshFailureKind(run.failure) ? run.failure : 'other';
    return { label: t(SSH_FAILURE_LABEL_KEYS[kind]), color: 'yellow', hint: t(SSH_FAILURE_HINT_KEYS[kind]) };
  }
  if (run.exitCode === undefined) return { label: t('sshExec.completed'), color: 'lime', hint: '' };
  return { label: t('sshExec.exitCode', { code: run.exitCode }), color: run.exitCode === 0 ? 'lime' : 'rose', hint: '' };
}

/** Ticks while the call runs; kept apart so only this text re-renders. */
function LiveDuration({ startedAt }: { startedAt?: string }) {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  return Number.isFinite(started) ? <>{formatSshExecDuration(Math.max(0, now - started))}</> : null;
}

/** The login this call waited on, if ssh could not authenticate on its own. */
function SshExecLoginLine({ login }: { login: SshExecLogin }) {
  const t = useT();
  const pending = isSshLoginPending(login);
  const label = pending
    ? t('sshExec.login.pending')
    : login.status === 'connected'
      ? t(login.remembered ? 'sshExec.login.connectedRemembered' : 'sshExec.login.connected')
      : t(login.status === 'pending' || login.status === 'timedOut' ? 'sshExec.login.timedOut' : login.status === 'declined' ? 'sshExec.login.declined' : 'sshExec.login.cancelled');
  return (
    <p data-ssh-login={login.status} className="mx-3.5 mt-1.5 flex items-center gap-1.5 text-caption-1-regular text-text-secondary">
      {pending ? <Spinner size="xs" className="size-3 text-current" /> : null}
      {label}
    </p>
  );
}

const REDACTION_LABEL_KEYS: Record<AgentOutputFilterCategory, MessageKey> = {
  privateKey: 'sshExec.redaction.privateKey',
  publicKey: 'sshExec.redaction.publicKey',
  credential: 'sshExec.redaction.credential',
  bankCard: 'sshExec.redaction.bankCard',
  idCard: 'sshExec.redaction.idCard',
  proxyCredential: 'sshExec.redaction.proxyCredential',
  urlToken: 'sshExec.redaction.urlToken',
  highEntropy: 'sshExec.redaction.highEntropy',
  uuid: 'sshExec.redaction.uuid',
  email: 'sshExec.redaction.email',
  phone: 'sshExec.redaction.phone',
  publicIp: 'sshExec.redaction.publicIp',
};

/** What the privacy filter kept from the agent; the output above stays raw. */
function SshExecRedactionsLine({ redactions }: { redactions: AgentOutputRedactions }) {
  const t = useT();
  const { total, items } = summarizeAgentOutputRedactions(redactions);
  if (!total) return null;
  const details = items
    .map(item => t('sshExec.redactionItem', { label: t(REDACTION_LABEL_KEYS[item.category]), count: item.count }))
    .join(t('sshExec.redactionSeparator'));
  return (
    <p data-ssh-redactions={total} className="mx-3.5 mt-1 flex items-start gap-1.5 text-caption-1-regular text-text-secondary">
      <RiShieldKeyholeLine aria-hidden className="mt-px size-3.5 shrink-0 text-foreground-icon-tertiary" />
      <span className="min-w-0">{t('sshExec.redactions', { count: total, details })}</span>
    </p>
  );
}

/** One call. Memoized on the run object, which the runtime only replaces when
 * that call changes, so an output batch re-renders just its own card. */
const SshExecCard = memo(function SshExecCard({ run }: { run: SshExecRun }) {
  const t = useT();
  const [commandOpen, setCommandOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const status = runStatus(run);
  const running = run.status === 'running';
  const failed = isSshExecFailed(run);
  const output = useMemo(() => {
    const chunks = run.output.map(chunk => ({ stream: chunk.stream, data: stripAnsi(chunk.data) }));
    const text = chunks.map(chunk => chunk.data).join('');
    return { chunks, text, lines: countLines(text) };
  }, [run.output]);
  const collapsible = output.lines > SSH_EXEC_COLLAPSED_LINES;
  const clamped = collapsible && !expanded;
  // A collapsed running call shows its newest lines, like a terminal tail.
  useLayoutEffect(() => {
    const pre = preRef.current;
    if (pre && clamped && running) pre.scrollTop = pre.scrollHeight;
  }, [clamped, output, running]);
  const border = running
    ? 'border-accent-300'
    : failed ? 'border-border-error-default' : 'border-border-button-default';
  // A connection failure without output shows only its hint.
  const showOutput = Boolean(output.text) || running || !status.hint;
  return (
    <article data-ssh-exec={run.id} data-failed={failed || undefined} className={cx('mb-2.5 overflow-hidden rounded-2xl border bg-background-primary-default shadow-card', border)}>
      <div className="flex items-center gap-2 px-3 pt-2.5 text-caption-1-regular">
        <span className="min-w-0 truncate text-body-2-semibold text-text-primary">{run.host || '—'}</span>
        <span className="shrink-0 text-text-tertiary">{formatSshExecTime(run.startedAt, true)}</span>
        <span className="flex-1" />
        <span className="shrink-0 tabular-nums text-text-tertiary">
          {running ? <LiveDuration startedAt={run.startedAt} /> : run.durationMs !== undefined ? formatSshExecDuration(run.durationMs) : null}
        </span>
        <Chip variant="caption" color={status.color} className="shrink-0 gap-1 text-caption-1-semibold">
          {running ? <Spinner size="xs" className="size-3 text-current" /> : null}
          {status.label}
        </Chip>
      </div>
      <button
        type="button" aria-expanded={commandOpen} title={run.command}
        className="mx-3 mt-2 flex w-[calc(100%-1.5rem)] cursor-pointer items-start gap-1.5 rounded-xl bg-background-secondary-default px-2 py-1.5 text-start font-mono text-caption-1-regular text-text-primary transition-colors duration-150 ease outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        onClick={() => setCommandOpen(open => !open)}
      >
        <span aria-hidden="true" className="select-none text-text-accent">$</span>
        <span className={cx('min-w-0 flex-1 whitespace-pre-wrap break-all', !commandOpen && 'line-clamp-2')}>{run.command || '…'}</span>
      </button>
      {run.cwd ? (
        <div className="mx-3.5 mt-1 truncate text-caption-2-regular text-text-tertiary" title={run.cwd}>
          {t('sshExec.cwd')} <code className="font-mono">{run.cwd}</code>
        </div>
      ) : null}
      {run.login ? <SshExecLoginLine login={run.login} /> : null}
      {status.hint ? <div className="mx-3 mt-2 rounded-xl bg-status-yellow-background px-2.5 py-1.5 text-caption-1-regular text-status-yellow-text">{status.hint}</div> : null}
      {showOutput ? (
        <div className={cx('relative mx-3 mt-2 rounded-xl border border-separator-border', OUTPUT_BG)}>
          {output.text || running ? (
            <pre
              ref={preRef}
              aria-label={t('sshExec.output')}
              className="m-0 overflow-x-auto px-2.5 py-2 font-mono text-caption-1-regular whitespace-pre text-text-primary [tab-size:8]"
              style={clamped ? { maxHeight: `calc(${SSH_EXEC_COLLAPSED_LINES} * 1lh + 1rem)`, overflowY: 'hidden' } : undefined}
            >
              {output.chunks.map((chunk, index) => (
                <span key={index} data-stream={chunk.stream} className={chunk.stream === 'stderr' ? 'text-text-error-primary' : undefined}>{chunk.data}</span>
              ))}
            </pre>
          ) : (
            <p className="m-0 px-2.5 py-2 text-caption-1-regular italic text-text-tertiary">{t('sshExec.noOutput')}</p>
          )}
          {clamped ? (
            <div aria-hidden="true" className={cx('pointer-events-none absolute inset-x-0 h-9 from-transparent', OUTPUT_FADE, running ? 'top-0 rounded-t-xl bg-linear-to-t' : 'bottom-0 rounded-b-xl bg-linear-to-b')} />
          ) : null}
        </div>
      ) : null}
      {run.outputTruncated ? <p className="mx-3.5 mt-1 text-caption-2-regular text-text-tertiary">{t('sshExec.outputTruncated')}</p> : null}
      {run.redactions ? <SshExecRedactionsLine redactions={run.redactions} /> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 pt-2 pb-2.5">
        {collapsible ? (
          <LinkButton size="xs" onClick={() => setExpanded(open => !open)}>
            {expanded ? t('sshExec.collapse') : t('sshExec.expand', { lines: output.lines })}
          </LinkButton>
        ) : null}
        {run.command ? <LinkButton size="xs" onClick={() => copyText(run.command, t('sshExec.commandCopied'))}>{t('sshExec.copyCommand')}</LinkButton> : null}
        {!running && output.text ? <LinkButton size="xs" onClick={() => copyText(output.text, t('sshExec.outputCopied'))}>{t('sshExec.copyOutput')}</LinkButton> : null}
      </div>
    </article>
  );
});

function TurnSeparator({ label }: { label: string }) {
  return (
    <div role="separator" className="mx-1 mt-3.5 mb-2 flex items-center gap-2 text-caption-2-regular text-text-tertiary">
      <span className="h-px flex-1 bg-separator-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-separator-border" />
    </div>
  );
}

/**
 * Every agent `ssh_exec` call of one conversation as a scrolling log, oldest
 * first. While the reader is at the bottom new calls and output keep it
 * pinned there; once they scroll up a "new results" pill appears instead.
 */
export function SshExecPane({ conversationId, runs, isActive }: { conversationId: string; runs: readonly SshExecRun[]; isActive: boolean }) {
  const t = useT();
  const clear = useSshExecClear(conversationId);
  const shown = useMemo(() => visibleSshExecs(runs, clear), [clear, runs]);
  const turns = useMemo(() => sshExecTurns(runs), [runs]);
  const hosts = useMemo(() => [...new Set(shown.map(run => run.host).filter(Boolean))], [shown]);
  const [hostFilter, setHostFilter] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const host = hosts.includes(hostFilter) ? hostFilter : '';
  const filtered = useMemo(
    () => shown.filter(run => (!host || run.host === host) && (!failedOnly || isSshExecFailed(run))),
    [failedOnly, host, shown],
  );
  const failedCount = useMemo(() => shown.filter(isSshExecFailed).length, [shown]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [behind, setBehind] = useState(false);
  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    followRef.current = true;
    setBehind(false);
  }, []);
  // Changing what is shown is the reader's own action; start from the newest.
  useLayoutEffect(() => { scrollToBottom(); }, [clear, failedOnly, host, scrollToBottom]);
  // New calls or output: stay pinned, or flag that there is more below.
  useLayoutEffect(() => {
    if (!isActive) return;
    if (followRef.current) scrollToBottom();
    else setBehind(true);
  }, [filtered, isActive, scrollToBottom]);

  let lastTurn: string | undefined;
  const entries = filtered.map((run) => {
    let separator = null;
    if (run.turnId && run.turnId !== lastTurn) {
      lastTurn = run.turnId;
      const turn = turns.get(run.turnId);
      const time = formatSshExecTime(turn?.startedAt, false);
      if (turn) separator = <TurnSeparator label={time ? t('sshExec.turn', { n: turn.ordinal, time }) : t('sshExec.turnNoTime', { n: turn.ordinal })} />;
    }
    return <Fragment key={run.id}>{separator}<SshExecCard run={run} /></Fragment>;
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="shrink-0 text-headline-semibold text-text-primary">{t('sshExec.title')}</span>
        <span className="min-w-0 truncate text-caption-1-regular text-text-secondary">{t('sshExec.summary', { count: shown.length, failed: failedCount })}</span>
        <span className="flex-1" />
        <IconAction
          icon={RiFileCopyLine}
          size="sm"
          aria-label={t('sshExec.copyAll')}
          tooltip
          disabled={!filtered.length}
          onClick={() => copyText(sshExecTranscript(filtered), t('sshExec.allCopied'))}
        />
        <IconAction
          icon={RiDeleteBinLine}
          size="sm"
          aria-label={t('sshExec.clearView')}
          tooltip
          disabled={!shown.length}
          onClick={() => clearSshExecView(conversationId, runs)}
        />
      </div>
      {shown.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2.5">
          <SegmentedControl
            aria-label={t('sshExec.allHosts')}
            className="max-w-full flex-wrap"
            selectedKeys={[host || ALL_HOSTS]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next !== undefined) setHostFilter(next === ALL_HOSTS ? '' : String(next));
            }}
          >
            <SegmentedControlItem id={ALL_HOSTS}>{t('sshExec.allHosts')}</SegmentedControlItem>
            {hosts.map(name => (
              <SegmentedControlItem key={name} id={name} className="max-w-48">
                <span className="min-w-0 truncate">{name}</span>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <Switch size="sm" className="ms-auto" isSelected={failedOnly} onChange={setFailedOnly}>
            {t('sshExec.failedOnly')}
          </Switch>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <ScrollArea
          className="h-full"
          contentClassName="px-3 pb-4"
          surface="secondary"
          viewportRef={scrollRef}
          role="log"
          aria-label={t('sshExec.title')}
          onScroll={(event) => {
            const element = event.currentTarget;
            followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD;
            if (followRef.current) setBehind(false);
          }}
        >
          {entries.length ? entries : (
            <div className="flex h-full items-center justify-center px-6 text-center text-body-regular text-text-tertiary">
              {shown.length ? t('sshExec.filteredEmpty') : t('sshExec.empty')}
            </div>
          )}
        </ScrollArea>
        {behind ? (
          <Button
            size="small"
            leadingIcon={RiArrowDownLine}
            className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full px-3 shadow-dropdown"
            onClick={scrollToBottom}
          >
            {t('sshExec.newResults')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

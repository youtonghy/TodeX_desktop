import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RiArrowDownLine, RiDeleteBinLine, RiFileCopyLine } from '@remixicon/react';
import { Button, Chip, Spinner, ToggleButton, Tooltip, toast } from '@heroui/react';
import { isSshFailureKind, type SshExecRun } from '@todex/protocol/ssh';
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
import { t, useT } from '../../i18n';

type ChipColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

/** Lines shown before an output block collapses behind "show all". */
export const SSH_EXEC_COLLAPSED_LINES = 12;
/** Distance from the bottom (px) that still counts as following the log. */
const FOLLOW_THRESHOLD = 40;
// Opaque, so the collapse fade can blend into it.
const OUTPUT_BG = 'bg-[color-mix(in_oklab,var(--surface-secondary)_55%,var(--surface))]';
const OUTPUT_FADE = 'to-[color-mix(in_oklab,var(--surface-secondary)_55%,var(--surface))]';
const FILTER_CLASS = 'h-6 rounded-full px-2.5 text-xs';

function copyText(text: string, success: string) {
  void navigator.clipboard.writeText(text)
    .then(() => toast.success(success))
    .catch(() => toast.danger(t('sshExec.copyFailed')));
}

function runStatus(run: SshExecRun): { label: string; color: ChipColor; hint: string } {
  if (run.status === 'running') return { label: t('sshExec.running'), color: 'accent', hint: '' };
  if (run.status === 'cancelled' || run.failure === 'cancelled') return { label: t('sshExec.cancelled'), color: 'default', hint: '' };
  if (run.status === 'failed') {
    const kind = isSshFailureKind(run.failure) ? run.failure : 'other';
    return { label: t(SSH_FAILURE_LABEL_KEYS[kind]), color: 'warning', hint: t(SSH_FAILURE_HINT_KEYS[kind]) };
  }
  if (run.exitCode === undefined) return { label: t('sshExec.completed'), color: 'success', hint: '' };
  return { label: t('sshExec.exitCode', { code: run.exitCode }), color: run.exitCode === 0 ? 'success' : 'danger', hint: '' };
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

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button size="sm" variant="ghost" className="text-accent-soft-foreground h-auto min-w-0 rounded-md px-1 py-0.5 text-xs font-medium" onPress={onPress}>
      {label}
    </Button>
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
    ? 'border-[color-mix(in_oklab,var(--accent)_45%,transparent)]'
    : failed ? 'border-[color-mix(in_oklab,var(--danger)_35%,transparent)]' : 'border-default';
  // A connection failure without output shows only its hint.
  const showOutput = Boolean(output.text) || running || !status.hint;
  return (
    <article data-ssh-exec={run.id} data-failed={failed || undefined} className={`bg-surface mb-2.5 overflow-hidden rounded-[calc(var(--radius)*0.9)] border ${border}`}>
      <div className="flex items-center gap-2 px-3 pt-2.5 text-xs">
        <span className="min-w-0 truncate text-[13px] font-semibold">{run.host || '—'}</span>
        <span className="text-muted shrink-0">{formatSshExecTime(run.startedAt, true)}</span>
        <span className="flex-1" />
        <span className="text-muted shrink-0 tabular-nums">
          {running ? <LiveDuration startedAt={run.startedAt} /> : run.durationMs !== undefined ? formatSshExecDuration(run.durationMs) : null}
        </span>
        <Chip size="sm" variant="soft" color={status.color} className="shrink-0 font-semibold">
          {running ? <Spinner size="sm" color="current" className="size-3" /> : null}
          <Chip.Label>{status.label}</Chip.Label>
        </Chip>
      </div>
      <button
        type="button" aria-expanded={commandOpen} title={run.command}
        className="bg-surface-secondary mx-3 mt-2 flex w-[calc(100%-1.5rem)] cursor-pointer items-start gap-1.5 rounded-lg px-2 py-1.5 text-left font-mono text-[12.5px] leading-normal"
        onClick={() => setCommandOpen(open => !open)}
      >
        <span aria-hidden="true" className="text-accent select-none">$</span>
        <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all${commandOpen ? '' : ' line-clamp-2'}`}>{run.command || '…'}</span>
      </button>
      {run.cwd ? (
        <div className="text-muted mx-3.5 mt-1 truncate text-[11.5px]" title={run.cwd}>
          {t('sshExec.cwd')} <code className="font-mono">{run.cwd}</code>
        </div>
      ) : null}
      {status.hint ? <div className="bg-warning-soft text-warning-soft-foreground mx-3 mt-2 rounded-lg px-2.5 py-1.5 text-xs">{status.hint}</div> : null}
      {showOutput ? (
        <div className={`relative mx-3 mt-2 rounded-lg border border-separator ${OUTPUT_BG}`}>
          {output.text || running ? (
            <pre
              ref={preRef}
              aria-label={t('sshExec.output')}
              className="m-0 overflow-x-auto px-2.5 py-2 font-mono text-xs leading-[1.55] whitespace-pre [tab-size:8]"
              style={clamped ? { maxHeight: `calc(${SSH_EXEC_COLLAPSED_LINES} * 1.55em + 1rem)`, overflowY: 'hidden' } : undefined}
            >
              {output.chunks.map((chunk, index) => (
                <span key={index} data-stream={chunk.stream} className={chunk.stream === 'stderr' ? 'text-danger-soft-foreground' : undefined}>{chunk.data}</span>
              ))}
            </pre>
          ) : (
            <p className="text-muted m-0 px-2.5 py-2 text-xs italic">{t('sshExec.noOutput')}</p>
          )}
          {clamped ? (
            <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 h-9 from-transparent ${OUTPUT_FADE} ${running ? 'top-0 rounded-t-lg bg-linear-to-t' : 'bottom-0 rounded-b-lg bg-linear-to-b'}`} />
          ) : null}
        </div>
      ) : null}
      {run.outputTruncated ? <p className="text-muted mx-3.5 mt-1 text-[11.5px]">{t('sshExec.outputTruncated')}</p> : null}
      <div className="flex flex-wrap items-center gap-1 px-2 pt-1 pb-1.5">
        {collapsible ? (
          <LinkButton label={expanded ? t('sshExec.collapse') : t('sshExec.expand', { lines: output.lines })} onPress={() => setExpanded(open => !open)} />
        ) : null}
        {run.command ? <LinkButton label={t('sshExec.copyCommand')} onPress={() => copyText(run.command, t('sshExec.commandCopied'))} /> : null}
        {!running && output.text ? <LinkButton label={t('sshExec.copyOutput')} onPress={() => copyText(output.text, t('sshExec.outputCopied'))} /> : null}
      </div>
    </article>
  );
});

function TurnSeparator({ label }: { label: string }) {
  return (
    <div role="separator" className="text-muted mx-1 mt-3.5 mb-2 flex items-center gap-2 text-[11px]">
      <span className="bg-separator h-px flex-1" />
      <span>{label}</span>
      <span className="bg-separator h-px flex-1" />
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
        <span className="shrink-0 text-[15px] font-semibold">{t('sshExec.title')}</span>
        <span className="text-muted min-w-0 truncate text-xs">{t('sshExec.summary', { count: shown.length, failed: failedCount })}</span>
        <span className="flex-1" />
        <Tooltip delay={200}>
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('sshExec.copyAll')} isDisabled={!filtered.length}
            onPress={() => copyText(sshExecTranscript(filtered), t('sshExec.allCopied'))}>
            <RiFileCopyLine className="size-4" />
          </Button>
          <Tooltip.Content className="text-xs">{t('sshExec.copyAll')}</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={200}>
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('sshExec.clearView')} isDisabled={!shown.length}
            onPress={() => clearSshExecView(conversationId, runs)}>
            <RiDeleteBinLine className="size-4" />
          </Button>
          <Tooltip.Content className="text-xs">{t('sshExec.clearView')}</Tooltip.Content>
        </Tooltip>
      </div>
      {shown.length ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2.5">
          <ToggleButton size="sm" className={FILTER_CLASS} isSelected={!host} onChange={() => setHostFilter('')}>
            {t('sshExec.allHosts')}
          </ToggleButton>
          {hosts.map(name => (
            <ToggleButton key={name} size="sm" className={FILTER_CLASS} isSelected={host === name} onChange={() => setHostFilter(name)}>
              {name}
            </ToggleButton>
          ))}
          <ToggleButton size="sm" className={FILTER_CLASS} isSelected={failedOnly} onChange={setFailedOnly}>
            {t('sshExec.failedOnly')}
          </ToggleButton>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          role="log"
          aria-label={t('sshExec.title')}
          className="h-full overflow-y-auto px-3 pb-4"
          onScroll={(event) => {
            const element = event.currentTarget;
            followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD;
            if (followRef.current) setBehind(false);
          }}
        >
          {entries.length ? entries : (
            <div className="text-muted flex h-full items-center justify-center px-6 text-center text-sm">
              {shown.length ? t('sshExec.filteredEmpty') : t('sshExec.empty')}
            </div>
          )}
        </div>
        {behind ? (
          <Button size="sm" className="bg-foreground text-background absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3.5 text-xs font-semibold shadow-lg" onPress={scrollToBottom}>
            <RiArrowDownLine className="size-3.5" />
            {t('sshExec.newResults')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

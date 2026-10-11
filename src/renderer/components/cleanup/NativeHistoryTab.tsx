import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip } from '@/components/base/badges/chip';
import { Select, SelectItem } from '@/components/base/select/select';
import { Modal } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import type {
  HistoryCleanupPolicyResponse,
  NativeHistoryProvider,
  NativeHistoryProviderInfo,
  NativeHistorySession,
  NativeHistoryTranscript,
} from '@todex/protocol/v2';
import { useT } from '../../i18n';
import { backendApi } from '../../session/helpers';
import type { TodeXSession } from '../../session/useTodeXSession';
import {
  CleanupPolicyCard,
  formatDateTime,
  pathName,
  reportCleanupResult,
  SelectableHistoryList,
  StorageSummaryCard,
  withCurrent,
  type HistoryListItem,
} from './CleanupParts';

const NATIVE_DEFAULT = 'default';
const NATIVE_RETENTION_OPTIONS = [1, 3, 7, 14, 30, 90, 180, 365];

/** Read-only view of the last messages of one native session. */
function TranscriptModal({ transcript, loading, onClose }: {
  transcript: NativeHistoryTranscript | null;
  loading: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const roleLabel = { user: t('cleanup.roleUser'), assistant: t('cleanup.roleAssistant'), tool: t('cleanup.roleTool'), system: t('cleanup.roleSystem') };
  return (
    <Modal
      isOpen={loading || transcript !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={transcript?.title || t('cleanup.untitledSession')}
      description={transcript?.cwd ?? undefined}
      size="3xl"
      className="max-h-[88vh]"
      bodyClassName="overflow-y-auto"
    >
      {loading && !transcript ? (
        <div className="flex justify-center py-10"><SpinnerIcon className="size-5 text-foreground-icon-tertiary" /></div>
      ) : transcript ? (
        <div className="flex flex-col gap-3 pb-2">
          {transcript.truncated ? (
            <p className="text-caption-1-regular text-text-tertiary">{t('cleanup.transcriptTruncated', { shown: transcript.messages.length, total: transcript.totalMessages })}</p>
          ) : null}
          {transcript.messages.length === 0 ? <p className="text-body-regular text-text-secondary">{t('cleanup.transcriptEmpty')}</p> : null}
          {transcript.messages.map((message, index) => (
            <div
              key={index}
              className={cx(
                'flex flex-col gap-1 rounded-2xl px-3 py-2',
                message.role === 'user' ? 'bg-background-secondary-default' : message.role === 'tool' ? 'border border-separator-border' : '',
              )}
            >
              <span className="text-caption-1-semibold text-text-tertiary">
                {roleLabel[message.role] ?? message.role}{message.at ? ` · ${formatDateTime(message.at)}` : ''}
              </span>
              <p className={cx('break-words whitespace-pre-wrap text-text-primary', message.role === 'tool' ? 'font-mono text-caption-1-regular' : 'text-body-regular')}>{message.text}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

/** One agent's own session history: usage, the daemon's automatic cleanup
 * (plus Claude Code's own retention setting), and the session list with a
 * transcript view. Sessions TodeX conversations resume, and running ones,
 * cannot be removed. */
export function NativeHistoryTab({ session, provider, label }: { session: TodeXSession; provider: NativeHistoryProvider; label: string }) {
  const t = useT();
  const [info, setInfo] = useState<NativeHistoryProviderInfo>();
  const [sessions, setSessions] = useState<NativeHistorySession[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [measuredAt, setMeasuredAt] = useState('');
  const [policy, setPolicy] = useState<HistoryCleanupPolicyResponse>();
  const [loading, setLoading] = useState(true);
  const [savingNative, setSavingNative] = useState(false);
  const [transcript, setTranscript] = useState<NativeHistoryTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const generation = useRef(0);
  const api = useCallback(() => backendApi(session.settings), [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.transportVerified, session.settings.serverUrl]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const [providers, list, nextPolicy] = await Promise.all([
        api().listNativeHistoryProviders(),
        api().listNativeHistorySessions(provider),
        api().getNativeHistoryPolicy(provider),
      ]);
      if (current !== generation.current) return;
      setInfo(providers.providers.find((item) => item.provider === provider));
      setSessions(list.sessions);
      setTotalBytes(list.totalBytes);
      setMeasuredAt(list.measuredAt);
      setPolicy(nextPolicy);
    } catch (error) {
      if (current === generation.current) toast.danger(error instanceof Error ? error.message : t('cleanup.readFailed'));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [api, provider]);

  useEffect(() => {
    setSessions([]);
    setInfo(undefined);
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const openTranscript = async (id: string) => {
    setTranscriptLoading(true);
    try {
      setTranscript(await api().getNativeHistoryTranscript(provider, id));
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cleanup.transcriptFailed'));
    } finally {
      setTranscriptLoading(false);
    }
  };

  const saveNativeRetention = async (days: number | null) => {
    setSavingNative(true);
    try {
      const next = await api().updateClaudeNativeRetention(days);
      setInfo((current) => current ? { ...current, native: { cleanupPeriodDays: next.cleanupPeriodDays, settingsPath: next.settingsPath } } : current);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cleanup.policySaveFailed'));
    } finally {
      setSavingNative(false);
    }
  };

  const displayName = session.v2Providers.find((item) => item.id === provider)?.displayName ?? label;
  const items: HistoryListItem[] = sessions.map((entry) => {
    const title = entry.title?.trim() || t('cleanup.untitledSession');
    const where = entry.cwd ? pathName(entry.cwd) : t('cleanup.unknownWorkspace');
    return {
      id: entry.id,
      provider,
      title,
      subtitle: `${where} · ${formatDateTime(entry.updatedAt)}`,
      subtitleTitle: entry.cwd ?? undefined,
      searchText: `${title} ${entry.cwd ?? ''} ${entry.id}`,
      updatedAt: entry.updatedAt,
      bytes: entry.bytes,
      locked: entry.running || entry.referencedBy.length > 0,
      badge: entry.running
        ? <Chip color="yellow">{t('cleanup.active')}</Chip>
        : entry.referencedBy.length > 0
          ? <Chip color="blue">{t('cleanup.inUseByTodex')}</Chip>
          : undefined,
      onView: info?.capabilities.view ? () => void openTranscript(entry.id) : undefined,
    };
  });

  const nativeDays = info?.native?.cleanupPeriodDays ?? null;
  const sizes = info?.capabilities.sizes ?? true;

  if (!loading && info && !info.available) {
    return (
      <StorageSummaryCard
        title={t('cleanup.agentTitle', { agent: displayName })}
        description={t('cleanup.agentMissing', { agent: displayName })}
        count={0}
        countLabel={t('cleanup.sessionCount')}
        totalBytes={0}
        measuredAt=""
        loading={loading}
        onRefresh={() => void refresh()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StorageSummaryCard
        title={t('cleanup.agentTitle', { agent: displayName })}
        description={t('cleanup.agentHint', { agent: displayName })}
        count={sessions.length}
        countLabel={t('cleanup.sessionCount')}
        totalBytes={totalBytes}
        measuredAt={measuredAt}
        capacity={sizes ? policy?.policy.maxTotalBytes : null}
        loading={loading}
        onRefresh={() => void refresh()}
      >
        {info?.root ? <p className="truncate font-mono text-caption-1-regular text-text-tertiary" title={info.root}>{info.root}</p> : null}
        {provider === 'grok-build' ? <p className="text-caption-1-regular text-text-secondary">{t('cleanup.grokNote')}</p> : null}
        {provider === 'devin' ? <p className="text-caption-1-regular text-text-secondary">{t('cleanup.devinNote')}</p> : null}
      </StorageSummaryCard>
      <CleanupPolicyCard
        hint={t('cleanup.agentAutoHint')}
        state={policy}
        sizes={sizes}
        onSave={async (next) => setPolicy(await api().updateNativeHistoryPolicy(provider, next))}
        onRun={async () => {
          reportCleanupResult(await api().runNativeHistoryPolicy(provider), { cleaned: 'cleanup.sessionsCleaned', skipped: 'cleanup.sessionsSkipped' });
          await refresh();
        }}
      >
        {info?.native ? (
          <div className="flex flex-col gap-1 border-t border-separator-border pt-3">
            <Select
              label={t('cleanup.claudeRetention')}
              hint={t('cleanup.claudeRetentionHint')}
              className="w-full sm:w-1/2"
              popoverClassName="w-(--trigger-width)"
              isDisabled={savingNative}
              selectedKey={nativeDays != null ? String(nativeDays) : NATIVE_DEFAULT}
              onSelectionChange={(key) => void saveNativeRetention(key === NATIVE_DEFAULT || key == null ? null : Number(key))}
            >
              <SelectItem id={NATIVE_DEFAULT} textValue={t('cleanup.claudeRetentionDefault')}>{t('cleanup.claudeRetentionDefault')}</SelectItem>
              {withCurrent(NATIVE_RETENTION_OPTIONS, nativeDays).map((days) => (
                <SelectItem key={days} id={String(days)} textValue={t('cleanup.days', { count: days })}>{t('cleanup.days', { count: days })}</SelectItem>
              ))}
            </Select>
          </div>
        ) : null}
      </CleanupPolicyCard>
      <SelectableHistoryList
        items={items}
        loading={loading}
        sizes={sizes}
        emptyLabel={t('cleanup.noSessions')}
        confirmTitle={(count) => t('cleanup.confirmSessionsTitle', { count })}
        confirmBody={(size) => size ? t('cleanup.confirmSessionsBody', { size }) : t('cleanup.confirmSessionsBodyNoSize')}
        onClean={async (ids) => {
          reportCleanupResult(await api().cleanupNativeHistory(provider, ids), { cleaned: 'cleanup.sessionsCleaned', skipped: 'cleanup.sessionsSkipped' });
          await refresh();
        }}
      />
      <TranscriptModal transcript={transcript} loading={transcriptLoading} onClose={() => { setTranscript(null); setTranscriptLoading(false); }} />
    </div>
  );
}

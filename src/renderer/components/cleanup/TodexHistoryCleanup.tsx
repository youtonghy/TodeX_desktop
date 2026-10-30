import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip } from '@/components/base/badges/chip';
import { BackendSelect } from '@/components/ui/backend-select';
import { toast } from '@/components/ui/toast';
import type { ConversationStorageEntry, HistoryCleanupPolicyResponse } from '@todex/protocol/v2';
import {
  CleanupPolicyCard,
  formatDateTime,
  pathName,
  reportCleanupResult,
  SelectableHistoryList,
  StorageSummaryCard,
  type HistoryListItem,
} from './CleanupParts';
import { useT } from '../../i18n';
import { backendApi } from '../../session/helpers';
import { privateConversationIds } from '../../session/privateConversations';
import { usePanelBackend, type PanelBackend } from '../../session/panelBackend';
import type { TodeXSession } from '../../session/useTodeXSession';

const ACTIVE_STATUSES = new Set(['running', 'waiting_permission']);

/** TodeX's own conversation history on a picked backend. Agents' own
 * session history is cleaned on each agent's page in CLI management. */
export function TodexHistoryCleanup({ session }: { session: TodeXSession }) {
  const backend = usePanelBackend(session);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <BackendSelect profiles={session.backendConnections} linkStates={session.backendLinkStatus} selectedId={backend.backendId} onChange={backend.setBackendId} />
      </div>
      {/* Keyed by backend so a switch starts from that backend's own data. */}
      <TodexHistoryTab key={backend.backendId} session={session} backend={backend} />
    </div>
  );
}

/** TodeX's own conversations on the picked backend: usage, the backend's
 * automatic cleanup policy, and manual (multi-)selection cleanup. */
function TodexHistoryTab({ session, backend }: { session: TodeXSession; backend: PanelBackend }) {
  const t = useT();
  const [entries, setEntries] = useState<ConversationStorageEntry[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [measuredAt, setMeasuredAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [policy, setPolicy] = useState<HistoryCleanupPolicyResponse>();
  const generation = useRef(0);
  const { getHistoryStorage, purgeConversations, forgetDeletedConversations, stores } = session;
  const { backendId, settings } = backend;
  const api = useCallback(() => backendApi(settings), [settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified, settings.serverUrl]);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const [storage, nextPolicy] = await Promise.all([getHistoryStorage(backendId), api().getHistoryCleanupPolicy()]);
      if (current !== generation.current) return;
      // Private conversations are not history: they are never listed here.
      const privateIds = privateConversationIds(stores.conversations.get());
      setEntries(storage.conversations.filter((entry) => entry.ephemeral !== true && !privateIds.has(entry.id)));
      setTotalBytes(storage.totalBytes);
      setMeasuredAt(storage.measuredAt);
      setPolicy(nextPolicy);
    } catch (error) {
      if (current === generation.current) toast.danger(error instanceof Error ? error.message : t('cleanup.readFailed'));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [api, backendId, getHistoryStorage, stores]);

  useEffect(() => {
    setEntries([]);
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const items: HistoryListItem[] = entries.map((entry) => {
    const title = entry.title?.trim() || t('cleanup.untitled');
    const active = ACTIVE_STATUSES.has(entry.status);
    return {
      id: entry.id,
      provider: entry.provider,
      title,
      subtitle: `${pathName(entry.workspace)} · ${formatDateTime(entry.updatedAt)}`,
      subtitleTitle: entry.workspace,
      searchText: `${entry.title ?? ''} ${entry.workspace}`,
      updatedAt: entry.updatedAt,
      bytes: entry.bytes,
      locked: active,
      badge: active
        ? <Chip color="yellow">{t('cleanup.active')}</Chip>
        : entry.archivedAt ? <Chip color="neutral">{t('cleanup.archived')}</Chip> : undefined,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <StorageSummaryCard
        title={t('cleanup.todexTitle')}
        description={t('cleanup.todexHint')}
        count={entries.length}
        countLabel={t('cleanup.count')}
        totalBytes={totalBytes}
        measuredAt={measuredAt}
        capacity={policy?.policy.maxTotalBytes}
        loading={loading}
        onRefresh={() => void refresh()}
      />
      <CleanupPolicyCard
        hint={t('cleanup.autoHint')}
        state={policy}
        onSave={async (next) => setPolicy(await api().updateHistoryCleanupPolicy(next))}
        onRun={async () => {
          const result = await api().runHistoryCleanupPolicy();
          forgetDeletedConversations(result.deleted, backendId);
          reportCleanupResult(result, { cleaned: 'cleanup.cleaned', skipped: 'cleanup.skipped' });
          await refresh();
        }}
      />
      <SelectableHistoryList
        items={items}
        loading={loading}
        emptyLabel={t('cleanup.empty')}
        confirmTitle={(count) => t('cleanup.confirmSelectedTitle', { count })}
        confirmBody={(size) => t('cleanup.confirmSelectedBody', { size: size ?? '' })}
        onClean={async (ids) => {
          reportCleanupResult(await purgeConversations(ids, backendId), { cleaned: 'cleanup.cleaned', skipped: 'cleanup.skipped' });
          await refresh();
        }}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RiRefreshLine, RiVipCrownLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { EmptyState } from '@/components/ui/empty-state';
import { AgentLimitsCard, type AgentLimitsCardProps } from '@/components/application/agent-limits/agent-limits-card';
import { SpinnerIcon } from '@/components/ui/spinner';
import type { ProviderQuotaSnapshot } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { ProviderIcon } from '../components/ProviderIcon';
import { getLocale, t, useT } from '../i18n';
import { backendApi } from '../session/helpers';
import { usePanelBackend } from '../session/panelBackend';
import { BackendSelect } from '@/components/ui/backend-select';
import { quotaLimits, quotaMessage } from '../session/quota';

type Props = {
  session: TodeXSession;
};

// Account-level plan quota (GET /v2/providers/quota), refreshed while the
// panel is open. Claude Code only reports during a turn, so its card may sit
// in the idle state until a session runs. Antigravity's windows come from
// `agy /usage`, one weekly and one 5-hour window per model group. Devin's ACP
// exposes no plan-quota surface today, so it is filtered out of the display
// order.
const QUOTA_REFRESH_MS = 60_000;
const QUOTA_PROVIDER_ORDER = ['codex', 'claude-code', 'antigravity'];
const QUOTA_HIDDEN_PROVIDERS = new Set(['devin']);
/** One provider on the BoardUI agent-limits card: its plan windows, plus the
 * current conversation's context window when that conversation runs on it. */
function QuotaCard({ snapshot, displayName, context }: {
  snapshot: ProviderQuotaSnapshot;
  displayName: string;
  context?: AgentLimitsCardProps['context'];
}) {
  const fetchedAt = typeof snapshot.fetchedAt === 'number' ? new Date(snapshot.fetchedAt).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) : null;
  const message = quotaMessage(snapshot);
  return (
    <AgentLimitsCard
      title={(
        <>
          <ProviderIcon provider={snapshot.provider} className="size-4" />
          <span className="truncate text-body-medium text-text-primary">{displayName}</span>
          {fetchedAt ? <span className="ms-auto shrink-0 text-caption-1-regular text-text-tertiary">{t('usage.quotaUpdated', { time: fetchedAt })}</span> : null}
        </>
      )}
      context={context}
      plan={snapshot.planType ?? undefined}
      limits={quotaLimits(snapshot)}
      emptyMessage={message}
      labels={{ context: t('usage.quotaContext'), limits: t('usage.quotaPlanLimits'), free: t('usage.quotaContextFree') }}
    />
  );
}

export function QuotaPanel({ session }: Props) {
  useT();
  const [snapshots, setSnapshots] = useState<Record<string, ProviderQuotaSnapshot>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backend = usePanelBackend(session);
  const { settings } = backend;
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const api = backendApi(settings);
      const response = await api.getProviderQuotas();
      if (current !== generation.current) return;
      setSnapshots(response.providers ?? {});
      setError(null);
    } catch (err) {
      if (current === generation.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [settings.serverUrl, settings.deviceSecret, settings.encryptionProtocol, settings.encryptionPublicKey, settings.transportVerified]);

  // Another backend's quotas replace this one's.
  useEffect(() => {
    setSnapshots({});
    setError(null);
  }, [backend.backendId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), QUOTA_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const ordered = useMemo(() => {
    const entries = Object.values(snapshots).filter((snapshot) => !QUOTA_HIDDEN_PROVIDERS.has(snapshot.provider));
    entries.sort((a, b) => {
      const rank = (id: string) => {
        const index = QUOTA_PROVIDER_ORDER.indexOf(id);
        return index === -1 ? QUOTA_PROVIDER_ORDER.length : index;
      };
      return rank(a.provider) - rank(b.provider) || a.provider.localeCompare(b.provider);
    });
    return entries;
  }, [snapshots]);

  // The current conversation's context window rides on its provider's card
  // when that conversation runs on the picked backend.
  const conversation = backend.backendId === session.activeBackendConnectionId ? session.activeConversation : null;
  const contextUsage = conversation ? session.contextUsageByConversation[conversation.id] : undefined;
  const contextProvider = conversation?.provider;
  const context: AgentLimitsCardProps['context'] = contextUsage?.contextWindow
    ? { max: contextUsage.contextWindow, segments: [{ label: t('usage.quotaContextUsed'), tokens: contextUsage.usedTokens }] }
    : undefined;

  const displayName = (provider: string) => {
    const descriptor = backend.providers.find((item) => item.id === provider);
    return descriptor?.displayName ?? provider;
  };

  return (
    <div className="flex flex-col gap-5 py-1">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-body-regular text-text-secondary">{t('usage.quotaHint')}</p>
        <BackendSelect profiles={session.backendConnections} linkStates={session.backendLinkStatus} selectedId={backend.backendId} onChange={backend.setBackendId} />
        <Button
          size="small"
          variant="secondary"
          className="shrink-0"
          leadingIcon={loading ? SpinnerIcon : RiRefreshLine}
          disabled={loading}
          aria-busy={loading || undefined}
          onClick={() => void refresh()}
        >
          {t('usage.quotaRefresh')}
        </Button>
      </div>
      {error ? <p className="text-caption-1-regular text-text-error-primary">{t('usage.quotaError', { reason: error })}</p> : null}
      {ordered.length ? (
        <div className="grid items-start gap-3 md:grid-cols-2">
          {ordered.map((snapshot) => (
            <QuotaCard
              key={snapshot.provider}
              snapshot={snapshot}
              displayName={displayName(snapshot.provider)}
              context={snapshot.provider === contextProvider ? context : undefined}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          className="min-h-48"
          icon={RiVipCrownLine}
          title={t(error ? 'usage.quotaError' : 'usage.quotaLoading', { reason: error ?? '' })}
        />
      )}
    </div>
  );
}

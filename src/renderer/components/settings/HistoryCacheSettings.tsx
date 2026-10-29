import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Switch } from '@/components/base/switch/switch';
import { useT } from '../../i18n';
import type { HistoryTailCache } from '../../session/historyCache';
import { formatBytes } from '../../session/helpers';
import { ConfirmDialog } from '../ui/modal';
import { toast } from '../ui/toast';
import { SettingsRow } from './SettingsRows';

/** Settings → General → Storage rows of the on-device history cache. */
export function HistoryCacheSettings({ cache }: { cache: HistoryTailCache }) {
  const t = useT();
  const [enabled, setEnabled] = useState(cache.isEnabled());
  const [usage, setUsage] = useState<{ conversations: number; bytes: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setEnabled(cache.isEnabled());
    cache.usage().then(setUsage, () => setUsage(null));
  }, [cache]);
  useEffect(() => {
    refresh();
    return cache.subscribe(refresh);
  }, [cache, refresh]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.danger(t('historyCache.failed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const usageText = !enabled ? t('historyCache.off')
    : usage && usage.conversations > 0 ? t('historyCache.usage', { count: usage.conversations, size: formatBytes(usage.bytes) })
      : t('historyCache.empty');

  return (
    <>
      <SettingsRow label={t('historyCache.title')} description={t('historyCache.hint')} align="start">
        <Switch
          size="sm"
          aria-label={t('historyCache.title')}
          isSelected={enabled}
          isDisabled={busy}
          onChange={(next) => void run(() => cache.setEnabled(next))}
        />
      </SettingsRow>
      <SettingsRow label={t('historyCache.stored')} description={usageText}>
        <Button size="small" variant="secondary" disabled={busy || !usage?.conversations} onClick={() => setConfirming(true)}>
          {t('historyCache.clear')}
        </Button>
      </SettingsRow>
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={t('historyCache.confirmTitle')}
        description={t('historyCache.confirmBody')}
        confirmLabel={t('historyCache.clear')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={busy}
        onConfirm={() => void run(async () => {
          await cache.clearAll();
          setConfirming(false);
        })}
      />
    </>
  );
}

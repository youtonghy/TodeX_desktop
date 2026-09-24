import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionSettings } from '@todex/protocol/todex';
import { readGitScan, type GitRepositoryItem } from '../lib/gitWorkspace';
import { t } from '../i18n';

export function useGitRepositories({ settings, workspacePath, scopeKey, enabled, thinking, refreshKey }: {
  settings: ConnectionSettings;
  workspacePath: string;
  scopeKey: string;
  enabled: boolean;
  thinking: boolean;
  refreshKey: boolean;
}) {
  const identity = JSON.stringify([scopeKey, workspacePath, settings.serverUrl, settings.deviceSecret]);
  const [result, setResult] = useState<{ identity: string; repositories: GitRepositoryItem[]; error: string } | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    if (!enabled || !workspacePath) {
      setResult(null);
      refreshRef.current = () => {};
      return;
    }
    let disposed = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (disposed || pending) return;
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      pending = true;
      controller = new AbortController();
      try {
        const data = await readGitScan(settings, workspacePath, controller.signal);
        if (!disposed) setResult({ identity, repositories: data.repositories, error: '' });
      } catch (cause) {
        if (!disposed) setResult({ identity, repositories: [], error: cause instanceof Error ? cause.message : t('git.readFailed') });
      } finally {
        pending = false;
        if (!disposed) timer = setTimeout(() => void poll(), thinking ? 5_000 : 30_000);
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') void poll();
      else clearTimeout(timer);
    };
    refreshRef.current = () => { void poll(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    void poll();
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      refreshRef.current = () => {};
    };
  }, [identity, enabled, workspacePath, settings, thinking, refreshKey]);
  const current = enabled && result?.identity === identity ? result : null;
  return { repositories: current?.repositories ?? null, error: current?.error ?? '', loading: enabled && !current, refresh };
}

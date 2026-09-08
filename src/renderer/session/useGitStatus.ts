import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionSettings } from '@todex/protocol/todex';
import { readGitStatus, type GitStatusSummary } from '../lib/gitWorkspace';

export function useGitStatus({ settings, workspacePath, scopeKey, enabled, thinking, refreshKey }: {
  settings: ConnectionSettings;
  workspacePath: string;
  scopeKey: string;
  enabled: boolean;
  thinking: boolean;
  refreshKey: boolean;
}) {
  const identity = JSON.stringify([scopeKey, workspacePath, settings.serverUrl, settings.authToken]);
  const [result, setResult] = useState<{ identity: string; data: GitStatusSummary | null; error: string } | null>(null);
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
        const data = await readGitStatus(settings, workspacePath, controller.signal);
        if (!disposed) setResult({ identity, data, error: '' });
      } catch (cause) {
        if (!disposed) setResult({ identity, data: null, error: cause instanceof Error ? cause.message : '读取 Git 状态失败' });
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
  return { data: current?.data ?? null, error: current?.error ?? '', loading: enabled && !current, refresh };
}

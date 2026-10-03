import { useEffect, useState } from 'react';
import type { AgentBrowserTab } from '../../preload/index';

/** Agent browser tabs the main process holds, kept in sync. */
export function useAgentBrowserTabs(): AgentBrowserTab[] {
  const [tabs, setTabs] = useState<AgentBrowserTab[]>([]);
  useEffect(() => {
    const api = window.todexDesktop.agentBrowser;
    let alive = true;
    const unsubscribe = api.onTabs(next => { if (alive) setTabs(next); });
    void api.list().then(next => { if (alive) setTabs(next); });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return tabs;
}

/** Main-process key of a conversation's tab: `<backend profile>:<conversation>`. */
export function agentBrowserKey(profileId: string, conversationId: string): string {
  return `${profileId}:${conversationId}`;
}

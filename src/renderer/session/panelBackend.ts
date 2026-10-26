import { useState } from 'react';
import type { TodeXSession } from './useTodeXSession';

const NO_PROVIDERS: TodeXSession['v2Providers'] = [];

/** The backend a workspace-less panel acts on: the focused backend when the
 * panel opens, then whatever is picked there. A picked backend that is
 * removed falls back to the focused one. */
export type PanelBackend = ReturnType<typeof usePanelBackend>;

export function usePanelBackend(session: TodeXSession) {
  const [picked, setPicked] = useState(session.activeBackendConnectionId);
  const exists = session.backendConnections.some((profile) => profile.id === picked && !profile.disabled);
  const backendId = exists ? picked : session.activeBackendConnectionId;
  const profile = session.backendConnections.find((item) => item.id === backendId);
  return {
    backendId,
    setBackendId: setPicked,
    profile,
    settings: session.settingsForBackend(backendId),
    providers: session.v2ProvidersByBackend[backendId] ?? NO_PROVIDERS,
  };
}

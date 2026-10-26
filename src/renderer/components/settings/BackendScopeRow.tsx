import { BackendSelect } from '@/components/ui/backend-select';
import { useT } from '../../i18n';
import type { PanelBackend } from '../../session/panelBackend';
import type { TodeXSession } from '../../session/useTodeXSession';
import { SettingsCard, SettingsRow } from './SettingsRows';

/** Backend picker heading a settings page whose settings live on a backend;
 * nothing with a single backend. */
export function BackendScopeRow({ session, backend }: { session: TodeXSession; backend: PanelBackend }) {
  const t = useT();
  if (session.backendConnections.filter((profile) => !profile.disabled).length < 2) return null;
  return (
    <SettingsCard>
      <SettingsRow label={t('backendSelect.label')} description={t('backendSelect.settingsHint')}>
        <BackendSelect profiles={session.backendConnections} linkStates={session.backendLinkStatus} selectedId={backend.backendId} onChange={backend.setBackendId} />
      </SettingsRow>
    </SettingsCard>
  );
}

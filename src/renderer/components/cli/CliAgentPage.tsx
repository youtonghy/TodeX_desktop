import { useState } from 'react';
import { MANAGED_PROVIDER_AGENTS, type ManagedCliProvider, type ManagedProviderAgent, type NativeHistoryProvider, type ProviderKind, type V2ApiClient } from '@todex/protocol/v2';
import { Tab, TabList, TabPanel, Tabs } from '@/components/base/tabs/tabs';
import { SettingsSubpage } from '@/components/settings/SettingsRows';
import { useT, type MessageKey } from '@/i18n';
import { hasCliSettings } from '@/lib/cliSettings';
import type { PanelBackend } from '@/session/panelBackend';
import { useBackendCapabilities } from '@/session/useBackendCapabilities';
import type { TodeXSession } from '@/session/useTodeXSession';
import { AgentProvidersPanel } from '../../screens/AgentProvidersPanel';
import { CapabilitiesPanel, type ProviderChoice } from '../../screens/CapabilitiesPanel';
import { NativeHistoryTab } from '../cleanup/NativeHistoryTab';
import { ProviderIcon } from '../ProviderIcon';
import { CliSettingsEditor } from './CliSettingsEditor';

/** A CLI's own page in CLI management, or the shared skills and MCPs. */
export type CliPage = ManagedCliProvider | 'shared';

type CliPageTab = 'settings' | 'capabilities' | 'accounts' | 'cleanup';

const TAB_LABELS: Record<CliPageTab, MessageKey> = {
  settings: 'cliPage.tabSettings',
  capabilities: 'cliPage.tabCapabilities',
  accounts: 'cliPage.tabAccounts',
  cleanup: 'cliPage.tabCleanup',
};

const NATIVE_HISTORY: readonly NativeHistoryProvider[] = ['claude-code', 'pi', 'codex', 'grok-build', 'devin'];

/** Skills and MCPs come from the picked backend's agents. */
function capabilityProvider(backend: PanelBackend, id: string): ProviderKind | undefined {
  return backend.providers.find((item) => item.id === id && item.available)?.id;
}

/** The tabs a CLI's page has; a CLI without any has no page. */
export function cliPageTabs(backend: PanelBackend, id: ManagedCliProvider): CliPageTab[] {
  const tabs: CliPageTab[] = [];
  if (hasCliSettings(id)) tabs.push('settings');
  if (capabilityProvider(backend, id)) tabs.push('capabilities');
  if ((MANAGED_PROVIDER_AGENTS as string[]).includes(id)) tabs.push('accounts');
  if ((NATIVE_HISTORY as string[]).includes(id)) tabs.push('cleanup');
  return tabs;
}

export function CliAgentPage({ session, backend, api, id, name, onBack }: {
  session: TodeXSession;
  backend: PanelBackend;
  api: () => V2ApiClient;
  id: ManagedCliProvider;
  name: string;
  onBack: () => void;
}) {
  const t = useT();
  const tabs = cliPageTabs(backend, id);
  const [picked, setPicked] = useState<CliPageTab>(tabs[0] ?? 'settings');
  const tab = tabs.includes(picked) ? picked : tabs[0];
  // A visited tab stays mounted (hidden), so unsaved settings edits survive
  // a look at another tab; unvisited ones load nothing.
  const [visited, setVisited] = useState<ReadonlySet<CliPageTab>>(() => new Set(tab ? [tab] : []));
  const select = (next: CliPageTab) => {
    setPicked(next);
    setVisited((current) => (current.has(next) ? current : new Set([...current, next])));
  };
  const provider = capabilityProvider(backend, id);
  return (
    <SettingsSubpage
      title={<span className="flex items-center gap-2"><ProviderIcon provider={id} className="size-5" />{name}</span>}
      onBack={onBack}
    >
      <Tabs selectedKey={tab} onSelectionChange={(key) => select(key as CliPageTab)} className="gap-4">
        <TabList aria-label={name}>
          {tabs.map((item) => <Tab key={item} id={item}>{t(TAB_LABELS[item])}</Tab>)}
        </TabList>
        {tabs.map((item) => (
          <TabPanel key={item} id={item} shouldForceMount className="data-[inert=true]:hidden">
            {!visited.has(item) && item !== tab ? null
              : item === 'settings' && hasCliSettings(id) ? <CliSettingsEditor provider={id} api={api} />
                : item === 'capabilities' && provider ? <BackendCapabilities session={session} backend={backend} provider={provider} />
                  : item === 'accounts' ? <AgentProvidersPanel key={backend.backendId} backend={backend} agent={id as ManagedProviderAgent} />
                    : item === 'cleanup' ? <NativeHistoryTab key={backend.backendId} backend={backend} provider={id as NativeHistoryProvider} label={name} />
                      : null}
          </TabPanel>
        ))}
      </Tabs>
    </SettingsSubpage>
  );
}

/** Skills and MCPs every agent shares. */
export function SharedCapabilitiesPage({ session, backend, onBack }: { session: TodeXSession; backend: PanelBackend; onBack: () => void }) {
  const t = useT();
  return (
    <SettingsSubpage title={t('cliPage.shared')} description={t('cliPage.sharedHint')} onBack={onBack}>
      <BackendCapabilities session={session} backend={backend} provider="common" />
    </SettingsSubpage>
  );
}

/** The focused backend's catalog is the session's, where skills attach to
 * the active conversation; another backend's is read on its own and only
 * browsed and edited. */
function BackendCapabilities({ session, backend, provider }: { session: TodeXSession; backend: PanelBackend; provider: ProviderChoice }) {
  const t = useT();
  const focused = backend.backendId === session.activeBackendConnectionId;
  const other = useBackendCapabilities(session, backend, !focused);
  if (focused) return <SessionCapabilities session={session} provider={provider} />;
  return (
    <CapabilitiesPanel
      inDialog
      lockedProvider={provider}
      workspacePath={other.workspacePath}
      providers={backend.providers}
      catalogs={other.catalogs}
      onRefresh={(kind) => void other.refresh(kind)}
      hint={t('cliPage.capabilitiesBackend', { name: backend.profile?.name ?? '' })}
      onPreviewSkill={(skill, kind) => other.previewSkill(kind, skill.resourceId)}
      onLoadMcpConfig={(server) => other.loadMcpConfig(server.provider, server.resourceId)}
      manager={other.manager}
    />
  );
}

function SessionCapabilities({ session, provider }: { session: TodeXSession; provider: ProviderChoice }) {
  const conversation = session.activeConversation;
  return (
    <CapabilitiesPanel
      inDialog
      lockedProvider={provider}
      workspacePath={session.activeWorkspace?.path ?? session.settings.defaultWorkspacePath}
      providers={session.v2Providers}
      catalogs={session.capabilityCatalogs}
      onRefresh={(kind) => void session.refreshCapabilityCatalog(kind)}
      conversationId={conversation?.id}
      selectedSkills={conversation ? session.selectedSkills[conversation.id] ?? [] : []}
      canInvoke={Boolean(conversation?.v2ConversationId)}
      onToggleSkill={(skill, kind) => conversation && session.toggleCatalogSkill(conversation.id, skill, kind)}
      onPreviewSkill={(skill, kind) => session.previewSkillResource(kind, skill.resourceId)}
      onLoadMcpConfig={(server) => session.getMcpServerConfig(server.provider, server.resourceId)}
      manager={session.capabilityManager}
    />
  );
}

import { useState } from 'react';
import { MANAGED_PROVIDER_AGENTS, type ManagedCliProvider, type ManagedProviderAgent, type NativeHistoryProvider, type ProviderKind, type V2ApiClient } from '@todex/protocol/v2';
import { Tab, TabList, TabPanel, Tabs } from '@/components/base/tabs/tabs';
import { SettingsNote, SettingsSubpage } from '@/components/settings/SettingsRows';
import { useT, type MessageKey } from '@/i18n';
import { hasCliSettings } from '@/lib/cliSettings';
import type { PanelBackend } from '@/session/panelBackend';
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

/** Skills and MCPs follow the active workspace, so they come from the
 * focused backend's agents rather than the backend picked for CLIs. */
function capabilityProvider(session: TodeXSession, id: string): ProviderKind | undefined {
  return session.v2Providers.find((item) => item.id === id && item.available)?.id;
}

/** The tabs a CLI's page has; a CLI without any has no page. */
export function cliPageTabs(session: TodeXSession, id: ManagedCliProvider): CliPageTab[] {
  const tabs: CliPageTab[] = [];
  if (hasCliSettings(id)) tabs.push('settings');
  if (capabilityProvider(session, id)) tabs.push('capabilities');
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
  const tabs = cliPageTabs(session, id);
  const [picked, setPicked] = useState<CliPageTab>(tabs[0] ?? 'settings');
  const tab = tabs.includes(picked) ? picked : tabs[0];
  // A visited tab stays mounted (hidden), so unsaved settings edits survive
  // a look at another tab; unvisited ones load nothing.
  const [visited, setVisited] = useState<ReadonlySet<CliPageTab>>(() => new Set(tab ? [tab] : []));
  const select = (next: CliPageTab) => {
    setPicked(next);
    setVisited((current) => (current.has(next) ? current : new Set([...current, next])));
  };
  const provider = capabilityProvider(session, id);
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
                : item === 'capabilities' && provider ? (
                  <div className="flex flex-col gap-3">
                    {backend.backendId !== session.activeBackendConnectionId ? (
                      <SettingsNote tone="warning" className="border-b-0 px-3">
                        {t('cliPage.capabilitiesBackend', { name: session.backendConnections.find((item) => item.id === session.activeBackendConnectionId)?.name ?? '' })}
                      </SettingsNote>
                    ) : null}
                    <SessionCapabilities session={session} provider={provider} />
                  </div>
                )
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
export function SharedCapabilitiesPage({ session, onBack }: { session: TodeXSession; onBack: () => void }) {
  const t = useT();
  return (
    <SettingsSubpage title={t('cliPage.shared')} description={t('cliPage.sharedHint')} onBack={onBack}>
      <SessionCapabilities session={session} provider="common" />
    </SettingsSubpage>
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

import { useEffect, useState } from 'react';
import type { AgentScope, ProviderDescriptor, ProviderKind, ProviderModelDescriptor, V2ApiClient } from '@todex/protocol/v2';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { Spinner } from '@/components/ui/spinner';
import { useT } from '../../i18n';
import { ProviderIcon } from '../ProviderIcon';
import { SETTINGS_ROW, SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from '../settings/SettingsRows';

/** Compact select trigger for the right side of a settings row. */
export const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';

type ModelList = { status: 'loading' | 'ready' | 'error'; models: ProviderModelDescriptor[] };

/** Whether `agent` may be called under `scope`. */
export function scopeAllowsAgent(scope: AgentScope, agent: ProviderKind): boolean {
  return scope.agents === null || scope.agents.includes(agent);
}

/**
 * Block 1 of Agent Calling: which agents (and which of their models) agents
 * may call through MCP and API keys may use through the CLI entry. Every
 * change saves at once through `onChange`.
 */
export function AgentScopeSettings({ api, providers, scope, workspace, disabled, onChange }: {
  api: V2ApiClient;
  /** The backend's agents. */
  providers: ProviderDescriptor[];
  scope: AgentScope;
  /** Workspace whose live model list is read; the descriptor's models otherwise. */
  workspace: string;
  disabled: boolean;
  onChange: (scope: AgentScope) => void;
}) {
  const t = useT();
  const [modelLists, setModelLists] = useState<Partial<Record<ProviderKind, ModelList>>>({});
  // Agents listed: the available ones, plus any allowed agent the backend no
  // longer offers so it can still be turned off.
  const listed = providers.filter(provider => provider.available || scope.agents?.includes(provider.id));
  const allAgents = scope.agents === null;

  const loadModels = (provider: ProviderDescriptor) => {
    if (modelLists[provider.id]) return;
    if (!workspace) {
      setModelLists(current => ({ ...current, [provider.id]: { status: 'ready', models: provider.models } }));
      return;
    }
    setModelLists(current => ({ ...current, [provider.id]: { status: 'loading', models: provider.models } }));
    api.listProviderModels(provider.id, workspace)
      .then(result => setModelLists(current => ({ ...current, [provider.id]: { status: 'ready', models: result.models } })))
      .catch(() => setModelLists(current => ({ ...current, [provider.id]: { status: 'error', models: provider.models } })));
  };
  // Agents limited to some models show their model list at once.
  useEffect(() => {
    for (const provider of listed) {
      if (scope.models[provider.id] && scopeAllowsAgent(scope, provider.id)) loadModels(provider);
    }
  }, [scope, providers]);

  const setAllAgents = (selected: boolean) => {
    onChange({ ...scope, agents: selected ? null : listed.filter(provider => provider.available).map(provider => provider.id) });
  };
  const setAgent = (agent: ProviderKind, selected: boolean) => {
    const current = scope.agents ?? listed.map(provider => provider.id);
    const agents = selected ? [...new Set([...current, agent])] : current.filter(id => id !== agent);
    onChange({ ...scope, agents });
  };
  const setModelMode = (provider: ProviderDescriptor, mode: 'all' | 'some') => {
    const models = { ...scope.models };
    if (mode === 'all') {
      delete models[provider.id];
    } else {
      // An empty list is rejected: start from the default (or first) model.
      const known = modelLists[provider.id]?.models ?? provider.models;
      const first = known.find(model => model.isDefault) ?? known[0];
      if (!first) return;
      models[provider.id] = [first.id];
      loadModels(provider);
    }
    onChange({ ...scope, models });
  };
  const setModel = (provider: ProviderKind, model: string, selected: boolean) => {
    const current = scope.models[provider] ?? [];
    const next = selected ? [...new Set([...current, model])] : current.filter(id => id !== model);
    if (!next.length) return;
    onChange({ ...scope, models: { ...scope.models, [provider]: next } });
  };

  return (
    <SettingsGroup label={t('agentCalling.scopeTitle')} description={t('agentCalling.scopeHint')}>
      <SettingsCard>
        <SettingsRow label={t('agentCalling.allAgents')} description={t('agentCalling.allAgentsHint')}>
          <Switch size="sm" aria-label={t('agentCalling.allAgents')} isSelected={allAgents} isDisabled={disabled} onChange={setAllAgents} />
        </SettingsRow>
        {listed.length ? listed.map((provider) => {
          const allowed = scopeAllowsAgent(scope, provider.id);
          const limited = scope.models[provider.id];
          const list = modelLists[provider.id];
          const known = list?.models ?? provider.models;
          // Saved models the live list no longer reports still show, checked.
          const models = [
            ...known.map(model => ({ id: model.id, label: model.displayName || model.id })),
            ...(limited ?? []).filter(id => !known.some(model => model.id === id)).map(id => ({ id, label: id })),
          ];
          return (
            <div key={provider.id} className={SETTINGS_ROW}>
              <div className="flex min-h-8 items-center justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <ProviderIcon provider={provider.id} className="size-5 shrink-0 text-foreground-icon-secondary" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-body-regular text-text-primary">{provider.displayName}</span>
                    {!provider.available ? (
                      <span className="truncate text-body-2-regular text-text-secondary">{provider.unavailableReason || t('agentCalling.agentUnavailable')}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {allowed ? (
                    <Select
                      aria-label={t('agentCalling.modelsFor', { agent: provider.displayName })}
                      selectedKey={limited ? 'some' : 'all'}
                      isDisabled={disabled}
                      triggerClassName={ROW_SELECT_TRIGGER}
                      onSelectionChange={(value) => { if (value === 'all' || value === 'some') setModelMode(provider, value); }}
                    >
                      <SelectItem id="all" textValue={t('agentCalling.modelsAll')}>{t('agentCalling.modelsAll')}</SelectItem>
                      <SelectItem id="some" textValue={t('agentCalling.modelsSome')} isDisabled={!known.length && !limited}>{t('agentCalling.modelsSome')}</SelectItem>
                    </Select>
                  ) : null}
                  <Switch
                    size="sm"
                    aria-label={t('agentCalling.allowAgent', { agent: provider.displayName })}
                    isSelected={allowed}
                    isDisabled={disabled || allAgents}
                    onChange={selected => setAgent(provider.id, selected)}
                  />
                </div>
              </div>
              {allowed && limited ? (
                <div className="flex flex-col gap-2 ps-8 pt-2.5">
                  {list?.status === 'loading' ? <Spinner size="sm" aria-label={t('agentCalling.modelsLoading')} /> : null}
                  {list?.status === 'error' ? <p className="text-body-2-regular text-text-secondary">{t('agentCalling.modelsLoadFailed')}</p> : null}
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                    {models.map(model => {
                      const checked = limited.includes(model.id);
                      return (
                        <Checkbox
                          key={model.id}
                          size="sm"
                          isSelected={checked}
                          // The last allowed model stays: an empty list is not a valid scope.
                          isDisabled={disabled || (checked && limited.length === 1)}
                          onChange={selected => setModel(provider.id, model.id, selected)}
                        >
                          <span className="min-w-0 truncate text-body-2-regular text-text-primary" title={model.id}>{model.label}</span>
                        </Checkbox>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          );
        }) : (
          <SettingsNote>{t('agentCalling.noAgents')}</SettingsNote>
        )}
      </SettingsCard>
    </SettingsGroup>
  );
}

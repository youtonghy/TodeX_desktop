import { useState } from 'react';
import type { AgentCallingApproval, ApiKeyCreateRequest, ApiKeyScopes, ApiKeySummary, ProviderDescriptor, ProviderKind } from '@todex/protocol/v2';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/base/textarea/textarea';
import { Modal } from '@/components/ui/modal';
import { getLocale, useT, type MessageKey } from '../../i18n';

export const APPROVAL_LABELS: Record<AgentCallingApproval, MessageKey> = {
  ask: 'agentCalling.approvalAsk',
  'auto-approve': 'agentCalling.approvalAuto',
  reject: 'agentCalling.approvalReject',
};
export const APPROVALS: AgentCallingApproval[] = ['ask', 'auto-approve', 'reject'];

const NAME_MAX = 100;
const WORKSPACES_MAX = 64;
const DAY_MS = 24 * 60 * 60 * 1000;
type Expiry = 'keep' | 'never' | '7' | '30' | '90' | '365';
const EXPIRY_DAYS: Expiry[] = ['7', '30', '90', '365'];

/** Absolute POSIX or Windows path. */
function isAbsolutePath(path: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
}

export function formatKeyDate(ms: number | null | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(getLocale(), { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/** What the form submits: a create request, or the full update of an edit. */
export type ApiKeyFormValues = Required<Pick<ApiKeyCreateRequest, 'name' | 'scopes' | 'approval'>> & {
  /** Absent: keep the current expiry (edit only). */
  expiresAt?: number | null;
};

/**
 * Create or edit an API key: name, agent scope, workspace scope, approval
 * policy and expiry. `key` set means edit.
 */
export function ApiKeyFormModal({ apiKey, providers, defaultWorkspace, onSubmit, onClose }: {
  apiKey?: ApiKeySummary;
  providers: ProviderDescriptor[];
  /** Prefills the workspace list of a new scope. */
  defaultWorkspace: string;
  onSubmit: (values: ApiKeyFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const editing = Boolean(apiKey);
  const [name, setName] = useState(apiKey?.name ?? '');
  const [agentMode, setAgentMode] = useState<'all' | 'some'>(apiKey?.scopes.agents ? 'some' : 'all');
  const [agents, setAgents] = useState<ProviderKind[]>(apiKey?.scopes.agents ?? []);
  const [workspaceMode, setWorkspaceMode] = useState<'all' | 'some'>(apiKey?.scopes.workspaces ? 'some' : 'all');
  const [workspaceText, setWorkspaceText] = useState((apiKey?.scopes.workspaces ?? (defaultWorkspace ? [defaultWorkspace] : [])).join('\n'));
  const [approval, setApproval] = useState<AgentCallingApproval>(apiKey?.approval ?? 'ask');
  const [expiry, setExpiry] = useState<Expiry>(apiKey ? (apiKey.expiresAt ? 'keep' : 'never') : 'never');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const listed = providers.filter(provider => provider.available || agents.includes(provider.id));
  const workspaces = workspaceText.split('\n').map(line => line.trim()).filter(Boolean);
  const nameError = !name.trim() ? t('agentCalling.keyNameRequired') : name.trim().length > NAME_MAX ? t('agentCalling.keyNameTooLong', { max: NAME_MAX }) : '';
  const agentsError = agentMode === 'some' && !agents.length ? t('agentCalling.keyAgentsRequired') : '';
  const workspacesError = workspaceMode !== 'some' ? ''
    : !workspaces.length || workspaces.length > WORKSPACES_MAX ? t('agentCalling.keyWorkspacesCount', { max: WORKSPACES_MAX })
      : workspaces.some(path => !isAbsolutePath(path)) ? t('agentCalling.keyWorkspacesAbsolute') : '';
  const valid = !nameError && !agentsError && !workspacesError;

  const submit = async () => {
    if (!valid || submitting) return;
    const scopes: ApiKeyScopes = {
      ...(agentMode === 'some' ? { agents } : {}),
      ...(workspaceMode === 'some' ? { workspaces } : {}),
    };
    const values: ApiKeyFormValues = {
      name: name.trim(),
      scopes,
      approval,
      ...(expiry === 'keep' ? {} : { expiresAt: expiry === 'never' ? null : Date.now() + Number(expiry) * DAY_MS }),
    };
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(values);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('agentCalling.saveFailed'));
      setSubmitting(false);
    }
  };

  const formId = editing ? 'api-key-edit' : 'api-key-create';
  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open && !submitting) onClose(); }}
      title={editing ? t('agentCalling.keyEditTitle') : t('agentCalling.keyCreateTitle')}
      description={editing ? apiKey?.prefix : t('agentCalling.keyCreateHint')}
      size="md"
      isDismissable={!submitting}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} disabled={!valid || submitting} aria-busy={submitting || undefined}>
            {editing ? t('common.save') : t('agentCalling.keyCreate')}
          </Button>
        </>
      )}
    >
      <form id={formId} className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Input
          className="w-full"
          label={t('agentCalling.keyName')}
          placeholder={t('agentCalling.keyNamePlaceholder')}
          value={name}
          onChange={setName}
          autoFocus
          maxLength={NAME_MAX}
          isRequired
          isInvalid={Boolean(name) && Boolean(nameError)}
          hint={name ? nameError || undefined : undefined}
        />
        <div className="flex flex-col gap-2">
          <Select
            label={t('agentCalling.keyAgents')}
            selectedKey={agentMode}
            onSelectionChange={(value) => { if (value === 'all' || value === 'some') setAgentMode(value); }}
          >
            <SelectItem id="all" textValue={t('agentCalling.keyAgentsAll')}>{t('agentCalling.keyAgentsAll')}</SelectItem>
            <SelectItem id="some" textValue={t('agentCalling.keyAgentsSome')}>{t('agentCalling.keyAgentsSome')}</SelectItem>
          </Select>
          {agentMode === 'some' ? (
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 ps-1 sm:grid-cols-2">
              {listed.map(provider => (
                <Checkbox
                  key={provider.id}
                  size="sm"
                  isSelected={agents.includes(provider.id)}
                  onChange={selected => setAgents(current => selected ? [...new Set([...current, provider.id])] : current.filter(id => id !== provider.id))}
                >
                  <span className="text-body-2-regular text-text-primary">{provider.displayName}</span>
                </Checkbox>
              ))}
              {agentsError ? <p className="col-span-full text-body-2-regular text-text-error-primary">{agentsError}</p> : null}
            </div>
          ) : null}
          <p className="text-body-2-regular text-text-secondary">{t('agentCalling.keyAgentsGlobalHint')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Select
            label={t('agentCalling.keyWorkspaces')}
            selectedKey={workspaceMode}
            onSelectionChange={(value) => { if (value === 'all' || value === 'some') setWorkspaceMode(value); }}
          >
            <SelectItem id="all" textValue={t('agentCalling.keyWorkspacesAll')}>{t('agentCalling.keyWorkspacesAll')}</SelectItem>
            <SelectItem id="some" textValue={t('agentCalling.keyWorkspacesSome')}>{t('agentCalling.keyWorkspacesSome')}</SelectItem>
          </Select>
          {workspaceMode === 'some' ? (
            <Textarea
              aria-label={t('agentCalling.keyWorkspacesSome')}
              value={workspaceText}
              onChange={setWorkspaceText}
              rows={3}
              autoResize
              maxRows={8}
              placeholder="/home/me/projects/app"
              fieldClassName="font-mono"
              isInvalid={Boolean(workspacesError)}
              hint={workspacesError || t('agentCalling.keyWorkspacesHint')}
            />
          ) : null}
        </div>
        <Select
          label={t('agentCalling.approval')}
          selectedKey={approval}
          onSelectionChange={(value) => { if (APPROVALS.includes(value as AgentCallingApproval)) setApproval(value as AgentCallingApproval); }}
        >
          {APPROVALS.map(id => <SelectItem key={id} id={id} textValue={t(APPROVAL_LABELS[id])}>{t(APPROVAL_LABELS[id])}</SelectItem>)}
        </Select>
        <Select
          label={t('agentCalling.keyExpiry')}
          selectedKey={expiry}
          onSelectionChange={(value) => setExpiry(value as Expiry)}
        >
          {[
            ...(apiKey?.expiresAt ? [<SelectItem key="keep" id="keep" textValue={t('agentCalling.keyExpiryKeep', { date: formatKeyDate(apiKey.expiresAt) })}>{t('agentCalling.keyExpiryKeep', { date: formatKeyDate(apiKey.expiresAt) })}</SelectItem>] : []),
            <SelectItem key="never" id="never" textValue={t('agentCalling.keyExpiryNever')}>{t('agentCalling.keyExpiryNever')}</SelectItem>,
            ...EXPIRY_DAYS.map(days => (
              <SelectItem key={days} id={days} textValue={t('agentCalling.keyExpiryDays', { count: Number(days) })}>{t('agentCalling.keyExpiryDays', { count: Number(days) })}</SelectItem>
            )),
          ]}
        </Select>
        {error ? <p role="alert" className="text-body-2-regular text-text-error-primary">{error}</p> : null}
      </form>
    </Modal>
  );
}

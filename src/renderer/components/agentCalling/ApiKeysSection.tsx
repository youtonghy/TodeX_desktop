import { useState } from 'react';
import { RiAddLine, RiDeleteBinLine, RiEdit2Line, RiKey2Line } from '@remixicon/react';
import type { ApiKeyCreated, ApiKeyStatus, ApiKeySummary, ProviderDescriptor, V2ApiClient } from '@todex/protocol/v2';
import { providerDisplayName } from '@todex/protocol/v2';
import { Chip, type ChipProps } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/base/table/table';
import { Alert } from '@/components/ui/alert';
import { CopyCodeButton } from '@/components/ui/code-block';
import { EmptyState } from '@/components/ui/empty-state';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { useT, type MessageKey } from '../../i18n';
import { SettingsCard, SettingsGroup } from '../settings/SettingsRows';
import { APPROVAL_LABELS, ApiKeyFormModal, formatKeyDate, type ApiKeyFormValues } from './ApiKeyFormModal';

const STATUS_LABELS: Record<ApiKeyStatus, MessageKey> = {
  active: 'agentCalling.keyActive',
  expired: 'agentCalling.keyExpired',
  revoked: 'agentCalling.keyRevoked',
};
const STATUS_COLORS: Record<ApiKeyStatus, NonNullable<ChipProps['color']>> = {
  active: 'lime',
  expired: 'yellow',
  revoked: 'neutral',
};

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; key: ApiKeySummary }
  | { kind: 'revoke'; key: ApiKeySummary }
  | { kind: 'created'; key: ApiKeyCreated };

/** API keys of the CLI entry: list, create (the full key shows once), edit, revoke. */
export function ApiKeysSection({ api, keys, providers, defaultWorkspace, onKeysChange }: {
  api: V2ApiClient;
  /** `undefined` while loading. */
  keys: ApiKeySummary[] | undefined;
  providers: ProviderDescriptor[];
  defaultWorkspace: string;
  onKeysChange: (update: (keys: ApiKeySummary[]) => ApiKeySummary[]) => void;
}) {
  const t = useT();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [revoking, setRevoking] = useState(false);
  const close = () => setDialog(null);
  const agentName = (id: string) => providers.find(item => item.id === id)?.displayName || providerDisplayName(id);

  const create = async (values: ApiKeyFormValues) => {
    const created = await api.createApiKey(values);
    const { key: _secret, ...summary } = created;
    onKeysChange(current => [summary, ...current.filter(item => item.id !== created.id)]);
    setDialog({ kind: 'created', key: created });
  };
  const update = async (id: string, values: ApiKeyFormValues) => {
    const updated = await api.updateApiKey(id, values);
    onKeysChange(current => current.map(item => (item.id === id ? updated : item)));
    close();
  };
  const revoke = async (key: ApiKeySummary) => {
    setRevoking(true);
    try {
      await api.revokeApiKey(key.id);
      onKeysChange(current => current.map(item => (item.id === key.id ? { ...item, status: 'revoked', revokedAt: Date.now() } : item)));
      close();
    } catch (error) {
      toast.danger(t('agentCalling.keyRevokeFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setRevoking(false);
    }
  };

  return (
    <SettingsGroup
      label={t('agentCalling.keysTitle')}
      description={t('agentCalling.keysHint')}
      action={<Button size="small" variant="secondary" leadingIcon={RiAddLine} onClick={() => setDialog({ kind: 'create' })} disabled={keys === undefined}>{t('agentCalling.keyCreate')}</Button>}
    >
      {keys && !keys.length ? (
        <SettingsCard className="ps-0">
          <EmptyState size="sm" icon={RiKey2Line} title={t('agentCalling.keysEmpty')} description={t('agentCalling.keysEmptyHint')} />
        </SettingsCard>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border-button-default">
          <Table aria-label={t('agentCalling.keysTitle')} size="sm">
            <TableHeader>
              <TableColumn id="name" isRowHeader>{t('agentCalling.keyName')}</TableColumn>
              <TableColumn id="status">{t('agentCalling.keyStatus')}</TableColumn>
              <TableColumn id="scope">{t('agentCalling.keyScope')}</TableColumn>
              <TableColumn id="dates">{t('agentCalling.keyDates')}</TableColumn>
              <TableColumn id="actions" aria-label={t('agentCalling.keyActions')}>{''}</TableColumn>
            </TableHeader>
            <TableBody items={keys ?? []} renderEmptyState={() => <p className="py-3 text-body-2-regular text-text-secondary">{t('agentCalling.loading')}</p>}>
              {(key) => (
                <TableRow id={key.id}>
                  <TableCell>
                    <div className="flex min-w-0 max-w-40 flex-col">
                      <span className="truncate text-body-2-medium text-text-primary" title={key.name}>{key.name}</span>
                      <span dir="ltr" className="truncate font-mono text-caption-1-regular text-text-tertiary" title={key.prefix}>{key.prefix}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip variant="caption" color={STATUS_COLORS[key.status]}>{t(STATUS_LABELS[key.status])}</Chip>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 max-w-48 flex-col text-caption-1-regular text-text-secondary">
                      <span className="truncate">{key.scopes.agents ? key.scopes.agents.map(agentName).join(', ') : t('agentCalling.keyAgentsAll')}</span>
                      <span className="truncate" title={key.scopes.workspaces?.join('\n')}>
                        {key.scopes.workspaces
                          ? key.scopes.workspaces.length === 1 ? key.scopes.workspaces[0] : t('agentCalling.keyWorkspacesCountLabel', { count: key.scopes.workspaces.length })
                          : t('agentCalling.keyWorkspacesAll')}
                      </span>
                      <span className="truncate">{t('agentCalling.keyApprovalLabel', { approval: t(APPROVAL_LABELS[key.approval]) })}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col whitespace-nowrap text-caption-1-regular text-text-secondary">
                      <span>{t('agentCalling.keyCreated', { date: formatKeyDate(key.createdAt) })}</span>
                      <span>{key.lastUsedAt ? t('agentCalling.keyLastUsed', { date: formatKeyDate(key.lastUsedAt) }) : t('agentCalling.keyNeverUsed')}</span>
                      {key.revokedAt ? <span>{t('agentCalling.keyRevokedAt', { date: formatKeyDate(key.revokedAt) })}</span>
                        : key.expiresAt ? <span>{t('agentCalling.keyExpires', { date: formatKeyDate(key.expiresAt) })}</span> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {key.status === 'revoked' ? null : (
                      <div className="flex items-center justify-end gap-0.5">
                        <IconAction size="sm" icon={RiEdit2Line} tooltip aria-label={t('agentCalling.keyEdit', { name: key.name })} onClick={() => setDialog({ kind: 'edit', key })} />
                        <IconAction size="sm" icon={RiDeleteBinLine} tooltip aria-label={t('agentCalling.keyRevoke', { name: key.name })} onClick={() => setDialog({ kind: 'revoke', key })} />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog?.kind === 'create' ? (
        <ApiKeyFormModal providers={providers} defaultWorkspace={defaultWorkspace} onSubmit={create} onClose={close} />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <ApiKeyFormModal apiKey={dialog.key} providers={providers} defaultWorkspace={defaultWorkspace} onSubmit={values => update(dialog.key.id, values)} onClose={close} />
      ) : null}
      <ConfirmDialog
        isOpen={dialog?.kind === 'revoke'}
        onOpenChange={(open) => { if (!open && !revoking) close(); }}
        title={t('agentCalling.keyRevokeTitle')}
        description={dialog?.kind === 'revoke' ? t('agentCalling.keyRevokeConfirm', { name: dialog.key.name }) : undefined}
        confirmLabel={t('agentCalling.keyRevokeAction')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        isPending={revoking}
        onConfirm={() => { if (dialog?.kind === 'revoke') void revoke(dialog.key); }}
      />
      {dialog?.kind === 'created' ? (
        <Modal
          isOpen
          onOpenChange={(open) => { if (!open) close(); }}
          title={t('agentCalling.keyCreatedTitle')}
          description={dialog.key.name}
          size="md"
          isDismissable={false}
          footer={<Button onClick={close}>{t('agentCalling.keyCreatedDone')}</Button>}
        >
          <div className="flex flex-col gap-3">
            <Alert status="warning" title={t('agentCalling.keyCreatedWarning')} />
            <div className="flex items-start gap-2 rounded-xl bg-background-secondary-default py-2.5 ps-3 pe-1.5">
              <code dir="ltr" className="min-w-0 flex-1 select-all break-all font-mono text-body-2-regular text-text-primary">{dialog.key.key}</code>
              <CopyCodeButton code={dialog.key.key} label={t('agentCalling.keyCopy')} />
            </div>
            <p className="text-body-2-regular text-text-secondary">{t('agentCalling.keyCreatedUsage')}</p>
          </div>
        </Modal>
      ) : null}
    </SettingsGroup>
  );
}

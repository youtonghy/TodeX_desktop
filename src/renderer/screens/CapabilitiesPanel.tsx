import { useMemo, useState } from 'react';
import { RiAddLine, RiArrowDownSLine, RiDeleteBinLine, RiEditLine, RiFlashlightLine, RiGitlabLine, RiRefreshLine } from '@remixicon/react';
import type { CatalogScope, McpCatalog, McpServerCatalogDescriptor, McpServerConfig, ProviderDescriptor, ProviderKind, SkillCatalog, SkillCatalogDescriptor } from '@todex/protocol/v2';
import { providerDisplayName } from '@todex/protocol/v2';
import { Button } from '@/components/base/buttons/button';
import { PillTab, PillTabList } from '@/components/base/tabs/pill-tab';
import { Tab, TabList, Tabs } from '@/components/base/tabs/tabs';
import { Card } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { IconAction } from '@/components/ui/icon-action';
import { ConfirmDialog } from '@/components/ui/modal';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cx } from '@/utils/cx';
import { ProviderIcon } from '../components/ProviderIcon';
import { useNoticeToast } from '../components/NoticeToast';
import { useT } from '../i18n';
import type { SelectedSkillAttachment } from '../session/helpers';
import { McpEditorModal, SkillEditorModal, type McpEditorTarget, type SkillEditorTarget } from './CapabilityEditor';

export type CatalogState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  skills?: SkillCatalog;
  mcp?: McpCatalog;
  error?: string;
};

/** Writes to the provider's own skill folders and MCP config files. */
export type CapabilityManager = {
  createSkill: (provider: ProviderKind, input: { source: string; name: string; content: string }) => Promise<SkillCatalogDescriptor>;
  updateSkill: (provider: ProviderKind, resourceId: string, content: string) => Promise<SkillCatalogDescriptor>;
  deleteSkill: (provider: ProviderKind, resourceId: string) => Promise<void>;
  createMcpServer: (provider: ProviderKind, input: { scope: CatalogScope; name: string; config: unknown }) => Promise<McpServerConfig>;
  updateMcpServer: (provider: ProviderKind, resourceId: string, input: { name: string; config: unknown }) => Promise<McpServerConfig>;
  deleteMcpServer: (provider: ProviderKind, resourceId: string) => Promise<void>;
};

type Props = {
  workspacePath: string;
  providers: ProviderDescriptor[];
  catalogs: Partial<Record<ProviderKind, CatalogState>>;
  onRefresh: (provider: ProviderKind) => void;
  conversationId?: string;
  selectedSkills?: SelectedSkillAttachment[];
  canInvoke?: boolean;
  onToggleSkill?: (skill: SkillCatalogDescriptor, provider: ProviderKind) => void;
  onPreviewSkill?: (skill: SkillCatalogDescriptor, provider: ProviderKind) => Promise<string>;
  onLoadMcpConfig?: (server: McpServerCatalogDescriptor) => Promise<McpServerConfig>;
  manager?: CapabilityManager;
  /** Hosted in a dialog whose heading already names the panel. */
  inDialog?: boolean;
  /** Shows only this agent's (or the shared) catalog, without the agent switcher. */
  lockedProvider?: ProviderChoice;
};

type ViewMode = 'skills' | 'mcp';
export type ProviderChoice = ProviderKind | 'common';
type PendingDelete =
  | { kind: 'skill'; provider: ProviderKind; skill: SkillCatalogDescriptor }
  | { kind: 'mcp'; server: McpServerCatalogDescriptor };

function isCommonSource(source: string): boolean {
  return source.toLowerCase().includes('shared') || source.toLowerCase().includes('common');
}

export function CapabilitiesPanel({
  workspacePath,
  providers,
  catalogs,
  onRefresh,
  conversationId,
  selectedSkills = [],
  canInvoke = false,
  onToggleSkill,
  onPreviewSkill,
  onLoadMcpConfig,
  manager,
  inDialog = false,
  lockedProvider,
}: Props) {
  const t = useT();
  const [viewMode, setViewMode] = useState<ViewMode>('skills');
  const [pickedProvider, setProviderChoice] = useState<ProviderChoice>('common');
  const providerChoice = lockedProvider ?? pickedProvider;
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [mcpConfigs, setMcpConfigs] = useState<Record<string, McpServerConfig>>({});
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [skillEditor, setSkillEditor] = useState<(SkillEditorTarget & { provider: ProviderKind; resourceId?: string }) | null>(null);
  const [mcpEditor, setMcpEditor] = useState<(McpEditorTarget & { provider: ProviderKind; resourceId?: string }) | null>(null);
  // Only agents that can run right now; a tab whose agent went away falls
  // back to the shared view.
  const availableProviders = useMemo(() => providers.filter((item) => item.available), [providers]);
  const provider = providerChoice === 'common' ? undefined : availableProviders.find((item) => item.id === providerChoice);
  const choice: ProviderChoice = provider ? provider.id : 'common';
  const providerKeys = useMemo(() => availableProviders.map((item) => item.id), [availableProviders]);
  const selectedCatalogs = choice === 'common'
    ? providerKeys.map((key) => catalogs[key]).filter(Boolean) as CatalogState[]
    : catalogs[choice] ? [catalogs[choice] as CatalogState] : [];
  const state = selectedCatalogs.find((item) => item.status === 'loading') ?? selectedCatalogs[0];
  const catalogError = [...new Set(selectedCatalogs.map(item => item.error).filter(Boolean))].join('\n');
  useNoticeToast(catalogError, { variant: 'danger', scope: `${workspacePath}:${choice}` });
  const skills = useMemo(() => {
    const items = selectedCatalogs.flatMap((item) => (item.skills?.skills ?? []).map((skill) => ({
      skill,
      provider: (item.skills?.provider ?? choice) as ProviderKind,
      editable: Boolean(manager && item.skills?.editable),
    })));
    // Resource ids are provider-scoped, so the common view folds one shared
    // skill across providers by name and source, like the MCP list below.
    const keyOf = (item: (typeof items)[number]) => choice === 'common'
      ? `${item.skill.name}:${item.skill.source}`
      : `${item.skill.resourceId}:${item.skill.name}`;
    return items.filter((item, index, list) => list.findIndex((candidate) => keyOf(candidate) === keyOf(item)) === index)
      .filter((item) => choice !== 'common' || isCommonSource(item.skill.source));
  }, [choice, manager, selectedCatalogs]);
  const mcpServers = useMemo(() => {
    const items = selectedCatalogs.flatMap((item) => (item.mcp?.servers ?? []).map((server) => ({
      server,
      editable: Boolean(manager && item.mcp?.editable),
    })));
    return items.filter((item, index, list) => {
      if (choice !== 'common') return true;
      if (!isCommonSource(item.server.source)) return false;
      return list.findIndex((candidate) => candidate.server.name === item.server.name && candidate.server.source === item.server.source) === index;
    });
  }, [choice, manager, selectedCatalogs]);
  // New skills go to the selected agent's folders; the shared view creates
  // in the shared folders through any agent that can write them.
  const skillCreateTarget = useMemo(() => {
    if (!manager) return null;
    for (const item of selectedCatalogs) {
      const sources = (item.skills?.creatableSources ?? []).filter((source) => choice !== 'common' || isCommonSource(source));
      if (item.skills && sources.length) return { provider: item.skills.provider, sources };
    }
    return null;
  }, [choice, manager, selectedCatalogs]);
  const mcpCreateTarget = useMemo(() => {
    if (!manager || choice === 'common') return null;
    const scopes = catalogs[choice]?.mcp?.creatableScopes ?? [];
    return scopes.length ? { provider: choice, scopes } : null;
  }, [catalogs, choice, manager]);
  const createTarget = viewMode === 'skills' ? skillCreateTarget : mcpCreateTarget;
  const refresh = () => {
    for (const key of choice === 'common' ? providerKeys : [choice]) onRefresh(key);
  };
  const openCreate = () => {
    if (viewMode === 'skills' && skillCreateTarget) {
      setSkillEditor({ mode: 'create', ...skillCreateTarget });
    } else if (viewMode === 'mcp' && mcpCreateTarget) {
      setMcpEditor({ mode: 'create', ...mcpCreateTarget });
    }
  };

  return (
    <div className={cx('flex h-full min-h-0 flex-col', inDialog ? 'py-1' : 'p-5')}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {inDialog ? null : <h2 className="text-title-3-semibold text-text-primary">{t('cap.title')}</h2>}
          <p className={cx('text-caption-1-regular text-text-secondary', !inDialog && 'mt-1')}>{provider ? `${providerDisplayName(provider.id, provider.displayName)} · ${workspacePath}` : t('cap.commonPath', { path: workspacePath })}</p>
          {conversationId && canInvoke ? (
            <p className="mt-1 text-caption-1-regular text-text-secondary">{t('cap.attachHint')}</p>
          ) : (
            <p className="mt-1 text-caption-1-regular text-text-secondary">{t('cap.needV2')}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {createTarget ? (
            <Button size="small" variant="secondary" leadingIcon={RiAddLine} onClick={openCreate}>
              {viewMode === 'skills' ? t('cap.newSkill') : t('cap.newMcp')}
            </Button>
          ) : null}
          <IconAction icon={RiRefreshLine} size="sm" aria-label={t('workbench.refresh')} onClick={refresh} />
        </div>
      </div>
      {lockedProvider ? null : <PillTabList className="mb-3 flex-wrap">
        <PillTab variant="gray" isSelected={choice === 'common'} onSelect={() => setProviderChoice('common')}>{t('cap.common')}</PillTab>
        {availableProviders.map((item) => (
          <PillTab key={item.id} variant="gray" isSelected={choice === item.id} onSelect={() => setProviderChoice(item.id)}>
            <span className="inline-flex items-center gap-1.5">
              <ProviderIcon provider={item.id} className="size-4" />
              {providerDisplayName(item.id)}
            </span>
          </PillTab>
        ))}
      </PillTabList>}
      <Tabs
        selectedKey={viewMode}
        onSelectionChange={(key) => setViewMode(key === 'mcp' ? 'mcp' : 'skills')}
      >
        <TabList aria-label={t('cap.tabsLabel')} className="grid grid-cols-2 gap-0">
          <Tab id="skills" className="justify-center">Skills</Tab>
          <Tab id="mcp" className="justify-center">MCPs</Tab>
        </TabList>
      </Tabs>
      {state?.status === 'loading' ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <Spinner size="md" />
          <p className="text-caption-1-regular text-text-secondary">{t('cap.loading')}</p>
        </div>
      ) : null}
      <ScrollArea className="mt-3 flex-1" contentClassName="flex flex-col gap-2" surface={inDialog ? 'full' : 'secondary'}>
        {viewMode === 'skills' && state?.status !== 'loading' ? (
          skills.length ? skills.map((item) => (
            <SkillRow
              key={`${item.skill.resourceId}:${item.skill.name}`}
              item={item.skill}
              selected={selectedSkills.some((skill) => skill.resourceId === item.skill.resourceId || skill.name === item.skill.name)}
              canSelect={Boolean(canInvoke && onToggleSkill)}
              editable={item.editable}
              preview={previews[item.skill.resourceId] ?? null}
              onEdit={() => setSkillEditor({
                mode: 'edit',
                name: item.skill.name,
                content: previews[item.skill.resourceId] ?? '',
                provider: item.provider,
                resourceId: item.skill.resourceId,
              })}
              onDelete={() => setPendingDelete({ kind: 'skill', provider: item.provider, skill: item.skill })}
              onToggle={() => onToggleSkill?.(item.skill, item.provider)}
              onPreview={async () => {
                if (!onPreviewSkill) return;
                try {
                  const content = await onPreviewSkill(item.skill, item.provider);
                  setPreviews((current) => ({ ...current, [item.skill.resourceId]: content }));
                } catch (error) {
                  toast.danger(error instanceof Error ? error.message : t('cap.previewFailed'));
                }
              }}
            />
          )) : <p className="py-10 text-center text-body-regular text-text-secondary">{t('cap.noSkills')}</p>
        ) : null}
        {viewMode === 'mcp' && state?.status !== 'loading' ? (
          mcpServers.length ? mcpServers.map(({ server, editable }) => (
            <McpRow
              key={`${server.resourceId}:${server.name}`}
              item={server}
              config={mcpConfigs[server.resourceId] ?? null}
              editable={editable}
              onLoad={async () => {
                if (!onLoadMcpConfig) return;
                try {
                  const config = await onLoadMcpConfig(server);
                  setMcpConfigs((current) => ({ ...current, [server.resourceId]: config }));
                } catch (error) {
                  toast.danger(error instanceof Error ? error.message : t('cap.mcpConfigFailed'));
                }
              }}
              onEdit={(config) => setMcpEditor({
                mode: 'edit',
                name: server.name,
                path: config.path,
                config: config.config,
                provider: server.provider,
                resourceId: server.resourceId,
              })}
              onDelete={() => setPendingDelete({ kind: 'mcp', server })}
            />
          )) : <p className="py-10 text-center text-body-regular text-text-secondary">{t('cap.noMcps')}</p>
        ) : null}
      </ScrollArea>
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}
        title={pendingDelete?.kind === 'skill' ? t('cap.deleteSkillTitle') : t('cap.deleteMcpTitle')}
        description={pendingDelete?.kind === 'skill'
          ? t('cap.deleteSkillBody', { name: pendingDelete.skill.name })
          : pendingDelete ? t('cap.deleteMcpBody', {
            name: pendingDelete.server.name,
            path: mcpConfigs[pendingDelete.server.resourceId]?.path ?? pendingDelete.server.source,
          }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        tone="danger"
        isPending={deleting}
        onConfirm={async () => {
          if (!pendingDelete || !manager) return;
          setDeleting(true);
          const name = pendingDelete.kind === 'skill' ? pendingDelete.skill.name : pendingDelete.server.name;
          try {
            if (pendingDelete.kind === 'skill') {
              await manager.deleteSkill(pendingDelete.provider, pendingDelete.skill.resourceId);
            } else {
              await manager.deleteMcpServer(pendingDelete.server.provider, pendingDelete.server.resourceId);
            }
            toast.success(t('cap.deleted', { name }));
            setPendingDelete(null);
          } catch (error) {
            toast.danger(error instanceof Error ? error.message : t('cap.deleteFailed'));
          } finally {
            setDeleting(false);
          }
        }}
      />
      <SkillEditorModal
        target={skillEditor}
        onClose={() => setSkillEditor(null)}
        onSubmit={async ({ source, name, content }) => {
          if (!manager || !skillEditor) return;
          if (skillEditor.mode === 'create') {
            await manager.createSkill(skillEditor.provider, { source, name, content });
          } else if (skillEditor.resourceId) {
            const resourceId = skillEditor.resourceId;
            await manager.updateSkill(skillEditor.provider, resourceId, content);
            setPreviews((current) => ({ ...current, [resourceId]: content }));
          }
        }}
      />
      <McpEditorModal
        target={mcpEditor}
        onClose={() => setMcpEditor(null)}
        onSubmit={async ({ scope, name, config }) => {
          if (!manager || !mcpEditor) return;
          const saved = mcpEditor.mode === 'create'
            ? await manager.createMcpServer(mcpEditor.provider, { scope, name, config })
            : mcpEditor.resourceId ? await manager.updateMcpServer(mcpEditor.provider, mcpEditor.resourceId, { name, config }) : null;
          if (saved) setMcpConfigs((current) => ({ ...current, [saved.descriptor.resourceId]: saved }));
        }}
      />
    </div>
  );
}

function SkillRow({
  item,
  selected,
  canSelect,
  editable,
  preview,
  onToggle,
  onPreview,
  onEdit,
  onDelete,
}: {
  item: SkillCatalogDescriptor;
  selected: boolean;
  canSelect: boolean;
  editable: boolean;
  preview: string | null;
  onToggle: () => void;
  onPreview: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const status = item.active && item.valid ? t('cap.statusActive') : item.shadowedBy ? t('cap.statusShadowed') : item.valid ? t('cap.statusInactive') : t('cap.statusInvalid');

  const handleToggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !preview && onPreview) {
      setLoading(true);
      try {
        await onPreview();
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Card
      variant="secondary"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      className={cx(
        'cursor-pointer gap-0 p-3.5 select-none',
        'outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        expanded ? 'bg-background-secondary-hover' : 'hover:bg-background-secondary-hover',
      )}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleToggle();
        }
      }}
    >
      <div className="flex gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-badge-new-background">
          <RiFlashlightLine aria-hidden className="size-4 text-badge-new-text" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-body-semibold text-text-primary">{item.name}</p>
            <div className="flex shrink-0 items-center gap-2">
              <span className={selected ? 'text-caption-1-medium text-text-accent' : 'text-caption-1-regular text-text-secondary'}>
                {selected ? t('cap.attached') : status}
              </span>
              <RiArrowDownSLine
                aria-hidden
                className={cx(
                  'size-4 text-foreground-icon-tertiary transition-transform duration-200 ease-out motion-reduce:transition-none',
                  expanded && 'rotate-180',
                )}
              />
            </div>
          </div>
          {item.description ? (
            <p className={cx('mt-1 text-caption-1-regular text-text-secondary', expanded ? 'whitespace-pre-line' : 'line-clamp-2')}>
              {item.description}
            </p>
          ) : null}
          <p className="mt-1.5 text-caption-2-regular text-text-tertiary">{item.scope} · {item.source}</p>

          {expanded ? (
            <div className="mt-3 cursor-default border-t border-separator-border pt-3" onClick={(e) => e.stopPropagation()}>
              {loading ? (
                <div className="flex items-center gap-2 py-3 text-caption-1-regular text-text-secondary">
                  <Spinner size="sm" />
                  <span>{t('cap.loadingSkill')}</span>
                </div>
              ) : preview ? (
                <div className="rounded-2lg border border-border-button-default bg-background-primary-default p-2.5">
                  <p className="mb-1 text-caption-2-medium text-text-secondary">{t('cap.previewLabel')}</p>
                  <pre className="max-h-52 overflow-auto font-mono text-caption-2-regular whitespace-pre-wrap text-text-primary select-text">
                    {preview.slice(0, 4000)}
                  </pre>
                </div>
              ) : (
                <p className="text-caption-1-regular text-text-secondary">{t('cap.noPreview')}</p>
              )}

              {canSelect || editable ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-caption-1-regular text-text-secondary">
                    {canSelect ? (selected ? t('cap.attachedToChat') : t('cap.attachable')) : null}
                  </span>
                  <div className="flex items-center gap-2">
                    {editable ? (
                      <>
                        <Button size="small" variant="secondary" leadingIcon={RiDeleteBinLine} onClick={onDelete}>{t('common.delete')}</Button>
                        <Button size="small" variant="secondary" leadingIcon={RiEditLine} onClick={onEdit} disabled={!preview && item.valid}>{t('cap.edit')}</Button>
                      </>
                    ) : null}
                    {canSelect ? (
                      <Button
                        size="small"
                        variant={selected ? 'secondary' : 'primary'}
                        onClick={onToggle}
                      >
                        {selected ? t('cap.detach') : t('cap.attach')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function McpRow({
  item,
  config,
  editable,
  onLoad,
  onEdit,
  onDelete,
}: {
  item: McpServerCatalogDescriptor;
  config: McpServerConfig | null;
  editable: boolean;
  onLoad: () => Promise<void>;
  onEdit: (config: McpServerConfig) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const status = item.enabled && item.active ? t('cap.statusActive') : item.shadowedBy ? t('cap.statusShadowed') : item.enabled ? t('cap.statusAvailable') : t('cap.statusDisabled');

  const handleToggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !config) {
      setLoading(true);
      try {
        await onLoad();
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <Card
      variant="secondary"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      className={cx(
        'cursor-pointer gap-0 p-3.5 select-none',
        'outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        expanded ? 'bg-background-secondary-hover' : 'hover:bg-background-secondary-hover',
      )}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleToggle();
        }
      }}
    >
      <div className="flex gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-status-lime-background">
          <RiGitlabLine aria-hidden className="size-4 text-status-lime-text" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-body-semibold text-text-primary">{item.name}</p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-caption-1-regular text-text-secondary">{status}</span>
              <RiArrowDownSLine
                aria-hidden
                className={cx(
                  'size-4 text-foreground-icon-tertiary transition-transform duration-200 ease-out motion-reduce:transition-none',
                  expanded && 'rotate-180',
                )}
              />
            </div>
          </div>
          <p className="mt-1.5 text-caption-2-regular text-text-tertiary">{item.transport} · {item.scope} · {item.source}</p>
          {item.error ? <p className="mt-1 text-caption-1-regular text-text-error-primary">{item.error}</p> : null}

          {expanded ? (
            <div className="mt-3 cursor-default border-t border-separator-border pt-3 select-text" onClick={(e) => e.stopPropagation()}>
              {loading ? (
                <div className="flex items-center gap-2 py-3 text-caption-1-regular text-text-secondary">
                  <Spinner size="sm" />
                  <span>{t('cap.loadingMcp')}</span>
                </div>
              ) : config ? (
                <>
                  <CodeBlock
                    className="my-0"
                    code={JSON.stringify({ [item.name]: config.config }, null, 2)}
                    language="json"
                    title={<span className="normal-case" title={config.path}>{config.path || 'JSON'}</span>}
                    codeClassName="max-h-72 overflow-auto"
                  />
                  {config.format === 'native' ? (
                    <p className="mt-3 text-caption-1-regular text-text-secondary">{t('cap.mcpNativeManaged')}</p>
                  ) : editable ? (
                    <div className="mt-3 flex justify-end gap-2">
                      <Button size="small" variant="secondary" leadingIcon={RiDeleteBinLine} onClick={onDelete}>{t('common.delete')}</Button>
                      <Button size="small" variant="secondary" leadingIcon={RiEditLine} onClick={() => onEdit(config)}>{t('cap.edit')}</Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-caption-1-regular text-text-secondary">{t('cap.mcpConfigFailed')}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

import { useMemo, useState } from 'react';
import { RiArrowDownSLine, RiDeleteBinLine, RiFlashlightLine, RiGitlabLine, RiRefreshLine } from '@remixicon/react';
import type { McpCatalog, McpServerCatalogDescriptor, McpServerConfig, ProviderDescriptor, ProviderKind, SkillCatalog, SkillCatalogDescriptor } from '@todex/protocol/v2';
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

export type CatalogState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  skills?: SkillCatalog;
  mcp?: McpCatalog;
  error?: string;
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
  onDeleteMcp?: (server: McpServerCatalogDescriptor) => Promise<void>;
  /** Hosted in a dialog whose heading already names the panel. */
  inDialog?: boolean;
};

type ViewMode = 'skills' | 'mcp';
type ProviderChoice = ProviderKind | 'common';

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
  onDeleteMcp,
  inDialog = false,
}: Props) {
  const t = useT();
  const [viewMode, setViewMode] = useState<ViewMode>('skills');
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('common');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [mcpConfigs, setMcpConfigs] = useState<Record<string, McpServerConfig>>({});
  const [pendingDelete, setPendingDelete] = useState<McpServerCatalogDescriptor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const provider = providerChoice === 'common' ? undefined : providers.find((item) => item.id === providerChoice);
  const providerKeys = useMemo(() => providers.map((item) => item.id), [providers]);
  const selectedCatalogs = providerChoice === 'common'
    ? providerKeys.map((key) => catalogs[key]).filter(Boolean) as CatalogState[]
    : catalogs[providerChoice] ? [catalogs[providerChoice] as CatalogState] : [];
  const state = selectedCatalogs.find((item) => item.status === 'loading') ?? selectedCatalogs[0];
  const catalogError = [...new Set(selectedCatalogs.map(item => item.error).filter(Boolean))].join('\n');
  useNoticeToast(catalogError, { variant: 'danger', scope: `${workspacePath}:${providerChoice}` });
  const skills = useMemo(() => {
    const items = selectedCatalogs.flatMap((item) => (item.skills?.skills ?? []).map((skill) => ({
      skill,
      provider: (item.skills?.provider ?? providerChoice) as ProviderKind,
    })));
    // Resource ids are provider-scoped, so the common view folds one shared
    // skill across providers by name and source, like the MCP list below.
    const keyOf = (item: (typeof items)[number]) => providerChoice === 'common'
      ? `${item.skill.name}:${item.skill.source}`
      : `${item.skill.resourceId}:${item.skill.name}`;
    return items.filter((item, index, list) => list.findIndex((candidate) => keyOf(candidate) === keyOf(item)) === index)
      .filter((item) => providerChoice !== 'common' || isCommonSource(item.skill.source));
  }, [providerChoice, selectedCatalogs]);
  const mcpServers = useMemo(() => {
    const items = selectedCatalogs.flatMap((item) => item.mcp?.servers ?? []);
    return items.filter((item, index, list) => {
      if (providerChoice !== 'common') return true;
      if (!isCommonSource(item.source)) return false;
      return list.findIndex((candidate) => candidate.name === item.name && candidate.source === item.source) === index;
    });
  }, [providerChoice, selectedCatalogs]);

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
        {providerChoice !== 'common' ? (
          <IconAction icon={RiRefreshLine} size="sm" aria-label={t('workbench.refresh')} onClick={() => onRefresh(providerChoice)} />
        ) : null}
      </div>
      <PillTabList className="mb-3 flex-wrap">
        <PillTab variant="gray" isSelected={providerChoice === 'common'} onSelect={() => setProviderChoice('common')}>{t('cap.common')}</PillTab>
        {providers.map((item) => (
          <PillTab key={item.id} variant="gray" isSelected={providerChoice === item.id} onSelect={() => setProviderChoice(item.id)}>
            <span className="inline-flex items-center gap-1.5">
              <ProviderIcon provider={item.id} className="size-4" />
              {providerDisplayName(item.id)}
              <span
                aria-hidden
                className={cx(
                  'size-1.5 shrink-0 rounded-full',
                  item.available ? 'bg-chart-7' : 'border border-foreground-icon-tertiary',
                )}
              />
            </span>
          </PillTab>
        ))}
      </PillTabList>
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
              preview={previews[item.skill.resourceId] ?? null}
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
          mcpServers.length ? mcpServers.map((item) => (
            <McpRow
              key={`${item.resourceId}:${item.name}`}
              item={item}
              config={mcpConfigs[item.resourceId] ?? null}
              canDelete={Boolean(onDeleteMcp)}
              onLoad={async () => {
                if (!onLoadMcpConfig) return;
                try {
                  const config = await onLoadMcpConfig(item);
                  setMcpConfigs((current) => ({ ...current, [item.resourceId]: config }));
                } catch (error) {
                  toast.danger(error instanceof Error ? error.message : t('cap.mcpConfigFailed'));
                }
              }}
              onDelete={() => setPendingDelete(item)}
            />
          )) : <p className="py-10 text-center text-body-regular text-text-secondary">{t('cap.noMcps')}</p>
        ) : null}
      </ScrollArea>
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}
        title={t('cap.deleteMcpTitle')}
        description={pendingDelete ? t('cap.deleteMcpBody', {
          name: pendingDelete.name,
          path: mcpConfigs[pendingDelete.resourceId]?.path ?? pendingDelete.source,
        }) : null}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        tone="danger"
        isPending={deleting}
        onConfirm={async () => {
          if (!pendingDelete || !onDeleteMcp) return;
          setDeleting(true);
          try {
            await onDeleteMcp(pendingDelete);
            toast.success(t('cap.mcpDeleted', { name: pendingDelete.name }));
            setPendingDelete(null);
          } catch (error) {
            toast.danger(error instanceof Error ? error.message : t('cap.deleteMcpFailed'));
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}

function SkillRow({
  item,
  selected,
  canSelect,
  preview,
  onToggle,
  onPreview,
}: {
  item: SkillCatalogDescriptor;
  selected: boolean;
  canSelect: boolean;
  preview: string | null;
  onToggle: () => void;
  onPreview: () => Promise<void>;
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

              {canSelect ? (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-caption-1-regular text-text-secondary">
                    {selected ? t('cap.attachedToChat') : t('cap.attachable')}
                  </span>
                  <Button
                    size="small"
                    variant={selected ? 'secondary' : 'primary'}
                    onClick={onToggle}
                  >
                    {selected ? t('cap.detach') : t('cap.attach')}
                  </Button>
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
  canDelete,
  onLoad,
  onDelete,
}: {
  item: McpServerCatalogDescriptor;
  config: McpServerConfig | null;
  canDelete: boolean;
  onLoad: () => Promise<void>;
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
                  {canDelete ? (
                    config.format === 'native' ? (
                      <p className="mt-3 text-caption-1-regular text-text-secondary">{t('cap.mcpNativeManaged')}</p>
                    ) : (
                      <div className="mt-3 flex justify-end">
                        <Button size="small" variant="danger" leadingIcon={RiDeleteBinLine} onClick={onDelete}>
                          {t('cap.deleteMcp')}
                        </Button>
                      </div>
                    )
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

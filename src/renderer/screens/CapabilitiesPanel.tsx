import { useMemo, useState } from 'react';
import { Button, Card, ScrollShadow, Spinner, Tabs, toast } from '@heroui/react';
import { RiArrowDownSLine, RiFlashlightLine, RiGitlabLine, RiRefreshLine } from '@remixicon/react';
import type { McpCatalog, McpServerCatalogDescriptor, ProviderDescriptor, ProviderKind, SkillCatalog, SkillCatalogDescriptor } from '@todex/protocol/v2';
import { providerDisplayName } from '@todex/protocol/v2';
import { ProviderIcon } from '../components/ProviderIcon';
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
  onRefreshMcp?: (resourceId: string) => void;
  onCallMcp?: (resourceId: string, toolName: string) => void;
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
  onRefreshMcp,
  onCallMcp,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('skills');
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('common');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const provider = providerChoice === 'common' ? undefined : providers.find((item) => item.id === providerChoice);
  const providerKeys = useMemo(() => providers.map((item) => item.id), [providers]);
  const selectedCatalogs = providerChoice === 'common'
    ? providerKeys.map((key) => catalogs[key]).filter(Boolean) as CatalogState[]
    : catalogs[providerChoice] ? [catalogs[providerChoice] as CatalogState] : [];
  const state = selectedCatalogs.find((item) => item.status === 'loading') ?? selectedCatalogs[0];
  const skills = useMemo(() => {
    const items = selectedCatalogs.flatMap((item) => (item.skills?.skills ?? []).map((skill) => ({
      skill,
      provider: (item.skills?.provider ?? providerChoice) as ProviderKind,
    })));
    return items.filter((item, index, list) => {
      const key = `${item.skill.resourceId}:${item.skill.name}`;
      return list.findIndex((candidate) => `${candidate.skill.resourceId}:${candidate.skill.name}` === key) === index;
    }).filter((item) => providerChoice !== 'common' || isCommonSource(item.skill.source));
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
    <div className="flex h-full min-h-0 flex-col p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Skills 和 MCPs</h2>
          <p className="text-muted mt-1 text-xs">{provider ? `${providerDisplayName(provider.id, provider.displayName)} · ${workspacePath}` : `通用能力 · ${workspacePath}`}</p>
          {conversationId && canInvoke ? (
            <p className="text-muted mt-1 text-xs">点选 Skill 会附加到下一条消息；发送后由 Backend 读取并注入。</p>
          ) : (
            <p className="text-muted mt-1 text-xs">请先新建 v2 对话后再附加 Skill 或调用 MCP。</p>
          )}
        </div>
        {providerChoice !== 'common' ? (
          <Button isIconOnly size="sm" variant="ghost" aria-label="刷新" onPress={() => onRefresh(providerChoice)}>
            <RiRefreshLine className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={providerChoice === 'common' ? 'primary' : 'tertiary'} onPress={() => setProviderChoice('common')}>通用</Button>
        {providers.map((item) => (
          <Button key={item.id} size="sm" variant={providerChoice === item.id ? 'primary' : 'tertiary'} onPress={() => setProviderChoice(item.id)}>
            <ProviderIcon provider={item.id} />
            {providerDisplayName(item.id)} {item.available ? '●' : '○'}
          </Button>
        ))}
      </div>
      <Tabs
        selectedKey={viewMode}
        onSelectionChange={(key) => setViewMode(key === 'mcp' ? 'mcp' : 'skills')}
        className="w-full"
      >
        <Tabs.ListContainer className="w-full">
          <Tabs.List aria-label="能力分类" className="grid w-full grid-cols-2">
            <Tabs.Tab id="skills">
              Skills
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="mcp">
              MCPs
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
      {state?.status === 'loading' ? (
        <div className="flex flex-col items-center py-10">
          <Spinner />
          <p className="text-muted mt-2 text-xs">正在读取目录…</p>
        </div>
      ) : null}
      {state?.error ? <p className="text-danger mt-3 text-sm">{state.error}</p> : null}
      <ScrollShadow className="mt-3 min-h-0 flex-1">
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
                  toast.danger(error instanceof Error ? error.message : '无法预览 Skill');
                }
              }}
            />
          )) : <p className="text-muted py-10 text-center text-sm">没有找到 Skill。</p>
        ) : null}
        {viewMode === 'mcp' && state?.status !== 'loading' ? (
          mcpServers.length ? mcpServers.map((item) => (
            <McpRow
              key={`${item.resourceId}:${item.name}`}
              item={item}
              canInvoke={canInvoke}
              onRefresh={() => onRefreshMcp?.(item.resourceId)}
              onCall={(toolName) => onCallMcp?.(item.resourceId, toolName)}
            />
          )) : <p className="text-muted py-10 text-center text-sm">没有找到 MCP Server。</p>
        ) : null}
      </ScrollShadow>
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
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const status = item.active && item.valid ? '当前启用' : item.shadowedBy ? '被覆盖' : item.valid ? '未启用' : '无效';

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
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      className={`mb-2 p-3.5 transition-all cursor-pointer select-none hover:bg-surface-secondary/40 active:bg-surface-secondary/60 ${
        expanded ? 'bg-surface-secondary/20 ring-1 ring-separator' : ''
      }`}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleToggle();
        }
      }}
    >
      <div className="flex gap-3">
        <div className="bg-accent-soft flex size-9 shrink-0 items-center justify-center rounded-lg">
          <RiFlashlightLine className="text-accent size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold text-sm">{item.name}</p>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`text-xs ${selected ? 'text-accent font-medium' : 'text-muted'}`}>
                {selected ? '已附加' : status}
              </span>
              <RiArrowDownSLine
                className={`text-muted size-4 transition-transform duration-200 ${
                  expanded ? 'rotate-180' : ''
                }`}
              />
            </div>
          </div>
          {item.description ? (
            <p className={`text-muted mt-1 text-xs leading-relaxed ${expanded ? 'whitespace-pre-line' : 'line-clamp-2'}`}>
              {item.description}
            </p>
          ) : null}
          <p className="text-muted mt-1.5 text-[11px]">{item.scope} · {item.source}</p>

          {expanded ? (
            <div className="mt-3 border-t border-separator/40 pt-3" onClick={(e) => e.stopPropagation()}>
              {loading ? (
                <div className="flex items-center gap-2 py-3 text-muted text-xs">
                  <Spinner size="sm" />
                  <span>正在加载 Skill 内容…</span>
                </div>
              ) : preview ? (
                <div className="rounded-lg bg-surface-secondary/60 border border-separator/50 p-2.5">
                  <p className="text-muted mb-1 text-[11px] font-medium">指令与配置内容</p>
                  <pre className="text-foreground/80 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed select-text">
                    {preview.slice(0, 4000)}
                  </pre>
                </div>
              ) : (
                <p className="text-muted text-xs">暂无预览内容。</p>
              )}

              {canSelect ? (
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-muted text-xs">
                    {selected ? '已附加到当前对话' : '可附加到下一条对话中'}
                  </span>
                  <Button
                    size="sm"
                    variant={selected ? 'secondary' : 'primary'}
                    onPress={onToggle}
                  >
                    {selected ? '取消附加' : '附加到下一条消息'}
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
  canInvoke,
  onRefresh,
  onCall,
}: {
  item: McpServerCatalogDescriptor;
  canInvoke: boolean;
  onRefresh: () => void;
  onCall: (toolName: string) => void;
}) {
  const status = item.enabled && item.active ? '当前启用' : item.shadowedBy ? '被覆盖' : item.enabled ? '可用' : '已禁用';
  return (
    <Card className="mb-2 p-3">
      <div className="flex gap-3">
        <div className="bg-success-soft flex size-9 items-center justify-center rounded-lg">
          <RiGitlabLine className="text-success size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold">{item.name}</p>
            <p className="text-muted text-xs">{status}</p>
          </div>
          <p className="text-muted mt-2 text-[11px]">{item.transport} · {item.scope} · {item.source}</p>
          {item.error ? <p className="text-danger mt-1 text-xs">{item.error}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {canInvoke ? (
              <Button size="sm" variant="tertiary" onPress={onRefresh}>刷新工具</Button>
            ) : null}
          </div>
          {item.tools?.length ? (
            <div className="mt-2 flex flex-col gap-1">
              {item.tools.map((tool) => (
                <div key={tool.name} className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs">{tool.name}{tool.description ? ` · ${tool.description}` : ''}</p>
                  {canInvoke ? (
                    <Button size="sm" variant="primary" onPress={() => onCall(tool.name)}>调用</Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted mt-2 text-xs">尚未列出工具。刷新后由 Backend 发现。</p>
          )}
        </div>
      </div>
    </Card>
  );
}

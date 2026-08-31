import { useMemo, useState } from 'react';
import { Button, Card, ScrollShadow, Spinner, Tabs } from '@heroui/react';
import { ArrowRotateRight, Thunderbolt, LogoGitlab } from '@gravity-ui/icons';
import type { McpCatalog, McpServerCatalogDescriptor, ProviderDescriptor, ProviderKind, SkillCatalog, SkillCatalogDescriptor } from '@todex/protocol/v2';

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
};

type ViewMode = 'skills' | 'mcp';
type ProviderChoice = ProviderKind | 'common';

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  acp: 'ACP',
  codex: 'Codex',
  pi: 'Pi',
  'claude-code': 'Claude Code',
};

function isCommonSource(source: string): boolean {
  return source.toLowerCase().includes('shared') || source.toLowerCase().includes('common');
}

export function CapabilitiesPanel({ workspacePath, providers, catalogs, onRefresh }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('skills');
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('common');
  const provider = providerChoice === 'common' ? undefined : providers.find((item) => item.id === providerChoice);
  const providerKeys = useMemo(() => providers.map((item) => item.id), [providers]);
  const selectedCatalogs = providerChoice === 'common'
    ? providerKeys.map((key) => catalogs[key]).filter(Boolean) as CatalogState[]
    : catalogs[providerChoice] ? [catalogs[providerChoice] as CatalogState] : [];
  const state = selectedCatalogs.find((item) => item.status === 'loading') ?? selectedCatalogs[0];
  const skills = useMemo(() => {
    const items = selectedCatalogs.flatMap((item) => item.skills?.skills ?? []);
    return items.filter((item, index, list) => {
      const key = `${item.name}:${item.scope}:${item.source}`;
      return list.findIndex((candidate) => `${candidate.name}:${candidate.scope}:${candidate.source}` === key) === index;
    }).filter((item) => providerChoice !== 'common' || isCommonSource(item.source));
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
          <p className="text-muted mt-1 text-xs">{provider ? `${provider.displayName} · ${workspacePath}` : `通用能力 · ${workspacePath}`}</p>
        </div>
        {providerChoice !== 'common' ? (
          <Button isIconOnly size="sm" variant="ghost" aria-label="刷新" onPress={() => onRefresh(providerChoice)}>
            <ArrowRotateRight className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={providerChoice === 'common' ? 'primary' : 'tertiary'} onPress={() => setProviderChoice('common')}>通用</Button>
        {providers.map((item) => (
          <Button key={item.id} size="sm" variant={providerChoice === item.id ? 'primary' : 'tertiary'} onPress={() => setProviderChoice(item.id)}>
            {PROVIDER_LABELS[item.id]} {item.available ? '●' : '○'}
          </Button>
        ))}
      </div>
      <Tabs selectedKey={viewMode} onSelectionChange={(key) => setViewMode(key === 'mcp' ? 'mcp' : 'skills')}>
        <Tabs.List>
          <Tabs.Tab id="skills">Skills</Tabs.Tab>
          <Tabs.Tab id="mcp">MCPs</Tabs.Tab>
        </Tabs.List>
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
          skills.length ? skills.map((item) => <SkillRow key={`${item.resourceId}:${item.name}`} item={item} />) : <p className="text-muted py-10 text-center text-sm">没有找到 Skill。</p>
        ) : null}
        {viewMode === 'mcp' && state?.status !== 'loading' ? (
          mcpServers.length ? mcpServers.map((item) => <McpRow key={`${item.resourceId}:${item.name}`} item={item} />) : <p className="text-muted py-10 text-center text-sm">没有找到 MCP Server。</p>
        ) : null}
      </ScrollShadow>
    </div>
  );
}

function SkillRow({ item }: { item: SkillCatalogDescriptor }) {
  const status = item.active && item.valid ? '当前启用' : item.shadowedBy ? '被覆盖' : item.valid ? '未启用' : '无效';
  return (
    <Card className="mb-2 p-3">
      <div className="flex gap-3">
        <div className="bg-accent-soft flex size-9 items-center justify-center rounded-lg">
          <Thunderbolt className="text-accent size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold">{item.name}</p>
            <p className="text-muted text-xs">{status}</p>
          </div>
          {item.description ? <p className="text-muted mt-1 line-clamp-3 text-xs">{item.description}</p> : null}
          <p className="text-muted mt-2 text-[11px]">{item.scope} · {item.source}</p>
        </div>
      </div>
    </Card>
  );
}

function McpRow({ item }: { item: McpServerCatalogDescriptor }) {
  const status = item.enabled && item.active ? '当前启用' : item.shadowedBy ? '被覆盖' : item.enabled ? '可用' : '已禁用';
  return (
    <Card className="mb-2 p-3">
      <div className="flex gap-3">
        <div className="bg-success-soft flex size-9 items-center justify-center rounded-lg">
          <LogoGitlab className="text-success size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold">{item.name}</p>
            <p className="text-muted text-xs">{status}</p>
          </div>
          <p className="text-muted mt-2 text-[11px]">{item.transport} · {item.scope} · {item.source}</p>
        </div>
      </div>
    </Card>
  );
}

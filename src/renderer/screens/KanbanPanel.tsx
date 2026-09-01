import { Calendar, Plus, ThunderboltFill } from '@gravity-ui/icons';
import { RiArrowRightLine, RiChat3Line, RiFolder3Line } from '@remixicon/react';
import { Button, Chip, Tooltip } from '@heroui/react';
import { EmptyState, Kanban } from '@heroui-pro/react';
import { providerDisplayName } from '@todex/protocol/v2';
import { ProviderIcon } from '../components/ProviderIcon';
import type { ConversationRecord } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';

type Props = { session: TodeXSession; onOpenConversation: () => void };

type ChipColor = 'accent' | 'danger' | 'default' | 'success' | 'warning';

type ColumnMeta = {
  bodyBg: string;
  btnStyle: string;
  countColor: string;
  indicator: string;
  pillBg: string;
};

const COLUMN_META: ColumnMeta[] = [
  {
    bodyBg: 'bg-accent/8',
    btnStyle: 'text-accent border-accent/30 hover:bg-accent/10',
    countColor: 'text-accent',
    indicator: 'bg-accent',
    pillBg: 'bg-accent/15',
  },
  {
    bodyBg: 'bg-warning/8',
    btnStyle: 'text-warning border-warning/30 hover:bg-warning/10',
    countColor: 'text-warning',
    indicator: 'bg-warning',
    pillBg: 'bg-warning/15',
  },
  {
    bodyBg: 'bg-danger/8',
    btnStyle: 'text-danger border-danger/30 hover:bg-danger/10',
    countColor: 'text-danger',
    indicator: 'bg-danger',
    pillBg: 'bg-danger/15',
  },
  {
    bodyBg: 'bg-success/8',
    btnStyle: 'text-success border-success/30 hover:bg-success/10',
    countColor: 'text-success',
    indicator: 'bg-success',
    pillBg: 'bg-success/15',
  },
];

const PROVIDER_STYLE: Record<ChipColor, { chipColor: ChipColor; squareColor: string }> = {
  accent: { chipColor: 'accent', squareColor: 'bg-accent' },
  danger: { chipColor: 'danger', squareColor: 'bg-danger' },
  default: { chipColor: 'default', squareColor: 'bg-default' },
  success: { chipColor: 'success', squareColor: 'bg-success' },
  warning: { chipColor: 'warning', squareColor: 'bg-warning' },
};

function isToday(timestamp: number, now = new Date()): boolean {
  const date = new Date(timestamp);
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function shortModel(model?: string): string | undefined {
  if (!model) return undefined;
  const name = model.split('/').pop() ?? model;
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}

function providerTone(provider?: string): ChipColor {
  const normalized = provider?.toLowerCase() || '';
  if (normalized.includes('pi')) return 'accent';
  if (normalized.includes('claude')) return 'warning';
  if (normalized.includes('codex')) return 'success';
  if (normalized.includes('glm') || normalized.includes('qwen') || normalized.includes('deepseek')) return 'danger';
  return 'default';
}

function modeLabel(mode?: ConversationRecord['mode']): string | undefined {
  if (mode === 'plan') return '规划';
  if (mode === 'implement') return '实现';
  return undefined;
}

function NotionCard({ conversation, thinking }: { conversation: ConversationRecord; thinking: boolean }) {
  const tone = providerTone(conversation.provider);
  const { chipColor, squareColor } = PROVIDER_STYLE[tone];
  const providerLabel = conversation.provider ? providerDisplayName(conversation.provider) : '对话';
  const model = shortModel(conversation.model);
  const mode = modeLabel(conversation.mode);
  const categories = [
    mode,
    thinking ? '进行中' : undefined,
  ].filter((value): value is string => Boolean(value));

  return (
    <>
      <div className="flex items-start gap-2">
        <span className={`mt-1 size-2.5 shrink-0 rounded-sm ${squareColor}`} />
        <span className="text-foreground font-semibold leading-snug">{conversation.title || '未命名对话'}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip color={chipColor} size="sm" variant="soft">{providerLabel}</Chip>
        {model ? <Chip size="sm" variant="secondary">{model}</Chip> : null}
        <span className="ring-background flex size-5 items-center justify-center overflow-hidden rounded-full ring-2">
          <ProviderIcon className="size-3.5" provider={conversation.provider} />
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-muted flex min-w-0 items-center gap-1 text-xs">
          <ThunderboltFill className="text-warning size-3 shrink-0" />
          <span className="truncate">{conversation.preview || '暂无预览'}</span>
        </span>
        <span className="text-muted flex shrink-0 items-center gap-1 text-xs">
          <Calendar className="size-3" />
          {formatTime(conversation.updatedAt)}
        </span>
      </div>

      {categories.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {categories.map((category) => (
            <Chip key={category} size="sm" variant="secondary">{category}</Chip>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function KanbanPanel({ session, onOpenConversation }: Props) {
  const today = new Date();
  const columns = session.workspaces.map((workspace) => ({
    workspace,
    conversations: session.conversations
      .filter((conversation) => conversation.workspaceId === workspace.id && !conversation.archived && isToday(conversation.updatedAt, today))
      .sort((left, right) => right.updatedAt - left.updatedAt),
  }));
  const total = columns.reduce((count, column) => count + column.conversations.length, 0);

  const openConversation = (workspaceId: string, conversationId: string) => {
    session.selectConversation(workspaceId, conversationId);
    onOpenConversation();
  };

  const enterWorkspace = (workspaceId: string) => {
    session.selectWorkspace(workspaceId);
    onOpenConversation();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-8 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RiChat3Line className="text-accent size-5" />
            <h1 className="truncate text-lg font-semibold">今日看板</h1>
            <Chip color="accent" size="sm" variant="soft">{total} 个对话</Chip>
          </div>
          <p className="text-muted mt-1 text-sm">按工作区查看今天更新的对话</p>
        </div>
        <Button size="sm" variant="secondary" onPress={onOpenConversation}>
          返回对话
          <RiArrowRightLine />
        </Button>
      </div>
      {columns.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Media variant="icon">
                <RiFolder3Line />
              </EmptyState.Media>
              <EmptyState.Title>还没有工作区</EmptyState.Title>
              <EmptyState.Description>创建工作区后，今天的对话会按列出现在这里。</EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pr-3">
          <Kanban hideScrollBar className="items-start overflow-visible px-5 pb-5" isEnabled={false}>
            {columns.map(({ workspace, conversations }, index) => {
              const meta = COLUMN_META[index % COLUMN_META.length];
              return (
                <Kanban.Column key={workspace.id} className="gap-0">
                  <div className="bg-background sticky top-0 z-10 pt-2">
                    <Kanban.ColumnHeader
                      className={`rounded-t-[calc(var(--radius-2xl)_+_var(--radius-sm))] px-3 py-2.5 ${meta.bodyBg}`}
                    >
                      <span className={`flex min-w-0 items-center gap-2 rounded-[calc(var(--radius)*infinity)] px-3 py-1 ${meta.pillBg}`}>
                        <Kanban.ColumnIndicator className={meta.indicator} />
                        <Kanban.ColumnTitle className="truncate">{workspace.name}</Kanban.ColumnTitle>
                      </span>
                      <Kanban.ColumnCount className={meta.countColor}>{conversations.length}</Kanban.ColumnCount>
                      <Kanban.ColumnActions>
                        <Tooltip delay={300}>
                          <Button
                            isIconOnly
                            aria-label="进入工作区"
                            className={meta.countColor}
                            size="sm"
                            variant="ghost"
                            onPress={() => enterWorkspace(workspace.id)}
                          >
                            <Plus />
                          </Button>
                          <Tooltip.Content>进入工作区</Tooltip.Content>
                        </Tooltip>
                      </Kanban.ColumnActions>
                    </Kanban.ColumnHeader>
                  </div>
                  <Kanban.ColumnBody className={`rounded-t-none ${meta.bodyBg}`}>
                    <Kanban.CardList
                      aria-label={`${workspace.name} 今日对话`}
                      className="pb-2 pt-0"
                      items={conversations}
                      renderEmptyState={() => (
                        <p className="text-muted px-3 py-8 text-center text-xs">今天暂无对话</p>
                      )}
                      onAction={(key) => openConversation(workspace.id, String(key))}
                    >
                      {(conversation: ConversationRecord) => (
                        <Kanban.Card id={conversation.id} textValue={conversation.title || '未命名对话'}>
                          <NotionCard
                            conversation={conversation}
                            thinking={session.thinkingConversations[conversation.id] === true}
                          />
                        </Kanban.Card>
                      )}
                    </Kanban.CardList>
                    <div className="p-2 pt-0">
                      <Button fullWidth className={meta.btnStyle} variant="outline" onPress={() => enterWorkspace(workspace.id)}>
                        <Plus />
                        进入工作区
                      </Button>
                    </div>
                  </Kanban.ColumnBody>
                </Kanban.Column>
              );
            })}
          </Kanban>
        </div>
      )}
    </div>
  );
}

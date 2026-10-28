import type { Key, ReactNode } from 'react';
import { SubmenuTrigger, type Selection } from 'react-aria-components';
import { RiArrowRightSLine } from '@remixicon/react';
import { Menu, MenuItem, MenuPopover, MenuSection, MenuSeparator } from '@/components/ui/menu';
import { useT } from '@/i18n';
import { conversationDisplayTitle, firstPromptText, type ConversationRecord } from '@/session/helpers';
import { sameRecordValues, useTimelineSelector } from '@/session/conversationStore';
import {
  cancelKanbanTaskSchedule,
  kanbanTaskCanStartConversation,
  kanbanTaskDraftText,
  kanbanTaskStatusLabel,
  kanbanTaskStatuses,
  removeKanbanTask,
  setKanbanTaskConversations,
  setKanbanTaskStatus,
  type KanbanTask,
  type KanbanTaskStatus,
  useKanbanTasks,
} from '@/session/kanbanTasks';
import type { TodeXSession } from '@/session/useTodeXSession';
import { groupLinkedConversations, keptTaskConversationIds, type LatestEntries } from './project-board-data';

/** What the board needs from the app to act on a task. */
export type TaskBoardHandlers = {
  session: TodeXSession;
  /** Every conversation that can be linked to a task. */
  conversations: readonly ConversationRecord[];
  latestEntries: LatestEntries;
  onOpenConversation: (workspaceId: string, conversationId: string) => void;
  /** Starts another conversation for the task, prefilled with its draft. */
  onStartConversation: (task: KanbanTask) => void;
  onSchedule: (task: KanbanTask) => void;
};

/**
 * The task's actions and their menu items, shared by the card's right-click
 * menu and the detail panel's "more" menu.
 */
export function useTaskActions(task: KanbanTask, handlers: TaskBoardHandlers, options: { onRename: () => void }) {
  const t = useT();
  const { session, conversations, latestEntries, onOpenConversation, onStartConversation, onSchedule } = handlers;
  // Title fallbacks of the task's conversations (their first prompts).
  const firstPrompts = useTimelineSelector(session.stores, (timeline) => Object.fromEntries(
    (task.conversationIds ?? []).map((id) => [id, firstPromptText(timeline, id)])), sameRecordValues);
  const linkedState = groupLinkedConversations(
    task, session, conversations, latestEntries, t('kanban.groupPlain'), t('kanban.linkStale'),
  );
  const { linked, staleCount } = linkedState;
  const allTasks = useKanbanTasks();
  // One conversation per task; a task split into subtasks talks through them.
  const hasSubtasks = allTasks.some((item) => item.parentId === task.id && !item.deletedAt);
  const canStart = kanbanTaskCanStartConversation(task, allTasks);
  // A scheduled conversation is the task's conversation, created now and
  // sent by the backend later.
  const canSchedule = canStart
    && session.v2Providers.some((provider) => provider.available && provider.capabilities.scheduledConversations === true);

  const run = (key: Key) => {
    const value = String(key);
    const separator = value.indexOf(':');
    const action = separator < 0 ? value : value.slice(0, separator);
    const argument = separator < 0 ? '' : value.slice(separator + 1);
    if (action === 'open') {
      onOpenConversation(task.workspaceId, linked[0]?.conversation.id ?? '');
    } else if (action === 'new') {
      if (canStart) onStartConversation(task);
    } else if (action === 'schedule') {
      if (canSchedule) onSchedule(task);
    } else if (action === 'cancel-schedule') {
      cancelKanbanTaskSchedule(task.id);
    } else if (action === 'draft' && argument) {
      const target = conversations.find((conversation) => conversation.id === argument);
      if (!target) return;
      const draft = kanbanTaskDraftText(task);
      session.setConversationChatDraft(target.id, (current) => (current.trim() ? `${current}\n${draft}` : draft));
      onOpenConversation(task.workspaceId, target.id);
    } else if (action === 'clear-stale') {
      setKanbanTaskConversations(task.id, keptTaskConversationIds(task, conversations));
    } else if (action === 'rename') {
      options.onRename();
    } else if (action === 'delete') {
      removeKanbanTask(task.id);
    }
  };

  const applyStatusSelection = (selection: Selection) => {
    if (selection === 'all') return;
    const status = [...selection][0];
    if (status) setKanbanTaskStatus(task.id, String(status) as KanbanTaskStatus);
  };

  /** Menu items; `closeOuter` closes a pointer-anchored menu after a submenu
   * action (outside a MenuTrigger the submenu cannot close it itself). */
  const items = (closeOuter?: () => void): ReactNode => (
    <>
      <MenuSection
        title={t('kanban.setStatus')}
        selectionMode="single"
        selectedKeys={new Set([task.status])}
        onSelectionChange={applyStatusSelection}
      >
        {kanbanTaskStatuses.map((status) => (
          <MenuItem key={status} id={status} textValue={kanbanTaskStatusLabel(status)}>
            {kanbanTaskStatusLabel(status)}
          </MenuItem>
        ))}
      </MenuSection>
      {canStart || linked.length || task.schedule?.status === 'pending' || staleCount ? <MenuSeparator /> : null}
      {canStart ? (
        <MenuItem id="new" textValue={t('kanban.newConversation')}>{t('kanban.newConversation')}</MenuItem>
      ) : null}
      {linked.length ? (
        <MenuItem id="open" textValue={t('kanban.openConversation')}>{t('kanban.openConversation')}</MenuItem>
      ) : null}
      {linked.length ? (
        <SubmenuTrigger>
          <MenuItem
            id="draft"
            textValue={t('kanban.draftToChat')}
            trailing={<RiArrowRightSLine aria-hidden className="size-4 text-foreground-icon-tertiary rtl:rotate-180" />}
          >
            {t('kanban.draftToChat')}
          </MenuItem>
          <MenuPopover placement="end top" offset={2}>
            <Menu aria-label={t('kanban.draftToChat')} onAction={(key) => { closeOuter?.(); run(key); }}>
              {linked.map(({ conversation }) => (
                <MenuItem
                  key={conversation.id}
                  id={`draft:${conversation.id}`}
                  textValue={conversationDisplayTitle(conversation, firstPrompts[conversation.id] ?? '')}
                >
                  {conversationDisplayTitle(conversation, firstPrompts[conversation.id] ?? '')}
                </MenuItem>
              ))}
            </Menu>
          </MenuPopover>
        </SubmenuTrigger>
      ) : null}
      {canSchedule ? (
        <MenuItem id="schedule" textValue={t('kanban.schedule')}>{t('kanban.schedule')}</MenuItem>
      ) : null}
      {task.schedule?.status === 'pending' ? (
        <MenuItem id="cancel-schedule" textValue={t('kanban.scheduleCancel')}>{t('kanban.scheduleCancel')}</MenuItem>
      ) : null}
      {staleCount ? (
        <MenuItem id="clear-stale" textValue={t('kanban.clearStale')}>{t('kanban.clearStale')}</MenuItem>
      ) : null}
      <MenuSeparator />
      <MenuItem id="rename" textValue={t('kanban.renameAria')}>{t('kanban.rename')}</MenuItem>
      <MenuItem id="delete" textValue={t('kanban.delete')} tone="danger">{t('kanban.delete')}</MenuItem>
    </>
  );

  return { run, items, canStart, canSchedule, hasSubtasks, ...linkedState };
}

import { useMemo, useState } from 'react';
import { RiFolder3Line } from '@remixicon/react';
import { ProjectBoard } from '@/components/application/project-board/project-board';
import type { LatestEntries, WorkspaceTasks } from '@/components/application/project-board/project-board-data';
import type { TaskBoardHandlers } from '@/components/application/project-board/task-actions';
import { Button } from '@/components/base/buttons/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScheduleConversationDialog } from '../components/ScheduleConversationDialog';
import { isNoneWorkspaceId } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import {
  attachKanbanTask,
  getKanbanTasks,
  kanbanTaskCanStartConversation,
  kanbanTaskDraftText,
  kanbanTasksForWorkspace,
  replaceKanbanTaskConversation,
  useKanbanTasks,
  type KanbanTask,
} from '../session/kanbanTasks';

type Props = { session: TodeXSession; onOpenConversation: () => void };

/** The task board: the BoardUI project-board template (status columns, task
 * sheet, create dialog) over the kanban store, plus the scheduled-conversation dialog. */
export function KanbanPanel({ session, onOpenConversation }: Props) {
  const t = useT();
  const allTasks = useKanbanTasks();
  const [schedulingTaskId, setSchedulingTaskId] = useState<string | null>(null);
  const schedulingTask = allTasks.find((task) => task.id === schedulingTaskId && !task.deletedAt) ?? null;
  // Columns list workspaces in the same manual order as the sidebar.
  // Tasks need a registered workspace, so the built-in None one is left out.
  const orderedWorkspaces = useMemo(() => session.workspaces.filter((workspace) => !isNoneWorkspaceId(workspace.id)).sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id),
  ), [session.workspaces]);
  const groups = useMemo<WorkspaceTasks[]>(() => orderedWorkspaces.map((workspace) => ({
    workspace,
    tasks: kanbanTasksForWorkspace(allTasks, workspace.id, workspace.backendConnectionId ?? session.activeBackendConnectionId),
  })), [orderedWorkspaces, allTasks, session.activeBackendConnectionId]);
  const total = groups.reduce((count, group) => count + group.tasks.length, 0);
  const conversations = useMemo(
    () => session.conversations.filter((conversation) => !conversation.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [session.conversations],
  );

  const latestEntries = useMemo(() => {
    const map: LatestEntries = {};
    for (const entry of session.timeline) {
      if (!entry.conversationId) continue;
      const existing = map[entry.conversationId] ??= { latest: undefined, latestIncomingAt: 0 };
      if (!existing.latest || entry.at > existing.latest.at) existing.latest = entry;
      if (entry.kind === 'incoming' && entry.at > existing.latestIncomingAt) existing.latestIncomingAt = entry.at;
    }
    return map;
  }, [session.timeline]);

  const openConversation = (workspaceId: string, conversationId: string) => {
    if (conversationId) session.selectConversation(workspaceId, conversationId);
    else session.selectWorkspace(workspaceId);
    onOpenConversation();
  };

  /** Starts the task's conversation, prefilled with its draft. It
   * is created on the backend right away: an unsent local draft is dropped
   * as soon as another one opens, and only the backend id resolves on other
   * devices and for schedules. */
  /** Creates the task's conversation as a scheduled one, prefilled with its
   * draft: what is sent there waits on the backend until `at`. */
  const scheduleTaskConversation = async (task: KanbanTask, at: string) => {
    if (!kanbanTaskCanStartConversation(task, getKanbanTasks())) return false;
    const record = await session.createScheduledConversation(task.workspaceId, at, { title: task.title });
    if (!record?.v2ConversationId) return false;
    attachKanbanTask(task.id, record.id);
    replaceKanbanTaskConversation(task.id, record.id, record.v2ConversationId);
    session.setConversationChatDraft(record.id, kanbanTaskDraftText(task));
    openConversation(task.workspaceId, record.id);
    return true;
  };

  const startTaskConversation = (task: KanbanTask) => {
    if (!kanbanTaskCanStartConversation(task, getKanbanTasks())) return;
    const created = session.createConversation(task.workspaceId, { title: task.title, fresh: true });
    if (!created) return;
    attachKanbanTask(task.id, created.id);
    session.setConversationChatDraft(created.id, kanbanTaskDraftText(task));
    openConversation(task.workspaceId, created.id);
    void session.materializeConversation(created.id, task.title).then((record) => {
      if (record?.v2ConversationId) replaceKanbanTaskConversation(task.id, created.id, record.v2ConversationId);
    });
  };

  const handlers: TaskBoardHandlers = {
    session,
    conversations,
    latestEntries,
    onOpenConversation: openConversation,
    onStartConversation: startTaskConversation,
    onSchedule: (task) => setSchedulingTaskId(task.id),
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-3 pt-1 pb-3 sm:px-6 sm:pb-5">
      {orderedWorkspaces.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
          <EmptyState icon={RiFolder3Line} title={t('kanban.noWorkspaces')} description={t('kanban.noWorkspacesHint')}>
            <Button size="small" variant="secondary" onClick={onOpenConversation}>{t('kanban.backToChat')}</Button>
          </EmptyState>
        </div>
      ) : (
        <ProjectBoard
          groups={groups}
          workspaces={orderedWorkspaces}
          total={total}
          handlers={handlers}
          defaultWorkspaceId={session.activeWorkspaceId}
          onBack={onOpenConversation}
        />
      )}
      <ScheduleConversationDialog
        isOpen={Boolean(schedulingTask)}
        mode="create"
        onConfirm={(at) => (schedulingTask ? scheduleTaskConversation(schedulingTask, at) : Promise.resolve(false))}
        onClose={() => setSchedulingTaskId(null)}
      />
    </div>
  );
}

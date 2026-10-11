import { useMemo, useState } from 'react';
import { RiFolder3Line } from '@remixicon/react';
import { ProjectBoard } from '@/components/application/project-board/project-board';
import { findTaskConversation, type LatestEntries, type WorkspaceTasks } from '@/components/application/project-board/project-board-data';
import type { TaskBoardHandlers } from '@/components/application/project-board/task-actions';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import { Textarea } from '@/components/base/textarea/textarea';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { conversationDisplayTitle, type ConversationRecord } from '../session/helpers';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import {
  attachKanbanTask,
  getKanbanTasks,
  kanbanBackendLocalTime,
  kanbanTaskCanStartConversation,
  kanbanTaskConversationIds,
  kanbanTaskDraftText,
  kanbanTasksForWorkspace,
  kanbanTimeZoneLabel,
  replaceKanbanTaskConversation,
  setKanbanTaskSchedule,
  useKanbanTasks,
  useKanbanTimeZone,
  type KanbanTask,
  type KanbanTaskSchedule,
} from '../session/kanbanTasks';

type Props = { session: TodeXSession; onOpenConversation: () => void };

/** Arms a task schedule. The time is wall-clock in the backend's zone, which
 * is where it runs; the send settings are snapshotted now, as the backend
 * cannot ask this device for them later. */
function ScheduleTaskDialog({ session, task, onClose }: {
  session: TodeXSession;
  task: KanbanTask | null;
  onClose: () => void;
}) {
  const t = useT();
  const zone = useKanbanTimeZone();
  const [action, setAction] = useState<KanbanTaskSchedule['action']>('start');
  const [conversationId, setConversationId] = useState('');
  const [at, setAt] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  // Sendable targets: linked conversations that exist on the backend.
  const targets = (task ? kanbanTaskConversationIds(task) : [])
    .map((id) => findTaskConversation(session.conversations, id))
    .filter((conversation): conversation is ConversationRecord => Boolean(conversation?.v2ConversationId && !conversation.archived));

  // A task holds one conversation: once it has one, a schedule sends to it.
  const startAllowed = !task || kanbanTaskConversationIds(task).length === 0;

  // Reset the form whenever the dialog opens for a task.
  if (task && openedFor !== task.id) {
    const previous = task.schedule?.status === 'pending' ? task.schedule : undefined;
    const target = previous?.action === 'send'
      ? targets.find((conversation) => conversation.v2ConversationId === previous.conversationId)
      : undefined;
    setOpenedFor(task.id);
    setAction(target || !startAllowed ? 'send' : 'start');
    setConversationId(target?.id ?? targets[0]?.id ?? '');
    setAt(previous?.at ?? (zone ? kanbanBackendLocalTime(zone, Date.now() + 60 * 60_000).slice(0, 14) + '00' : ''));
    setText(previous?.text ?? kanbanTaskDraftText(task));
    setError('');
  } else if (!task && openedFor !== null) {
    setOpenedFor(null);
  }

  const submit = () => {
    if (!task || !zone) return;
    if (!at || at <= kanbanBackendLocalTime(zone)) {
      setError(t('kanban.schedulePast'));
      return;
    }
    if (action === 'start' && !startAllowed) {
      setError(t('kanban.scheduleOneConversation'));
      return;
    }
    const target = action === 'send' ? targets.find((conversation) => conversation.id === conversationId) : undefined;
    if (action === 'send' && !target?.v2ConversationId) {
      setError(t('kanban.scheduleNoConversations'));
      return;
    }
    const settings = session.kanbanScheduleSettings(task.workspaceId, target?.id);
    if (!settings) {
      setError(t('kanban.scheduleNoAgent'));
      return;
    }
    setKanbanTaskSchedule(task.id, {
      ...settings,
      at,
      action,
      text: text.trim(),
      ...(target?.v2ConversationId ? { conversationId: target.v2ConversationId } : {}),
    });
    onClose();
  };

  return (
    <Modal
      isOpen={Boolean(task)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('kanban.scheduleTitle')}
      size="lg"
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={!zone || !at || !text.trim()}>{t('kanban.scheduleSave')}</Button>
        </>
      )}
    >
      <Select
        label={t('kanban.scheduleAction')}
        className="w-full"
        popoverClassName="w-(--trigger-width)"
        selectedKey={action}
        disabledKeys={[...(startAllowed ? [] : ['start']), ...(targets.length ? [] : ['send'])]}
        onSelectionChange={(key) => setAction(String(key) === 'send' ? 'send' : 'start')}
      >
        <SelectItem id="start" textValue={t('kanban.scheduleStart')}>{t('kanban.scheduleStart')}</SelectItem>
        <SelectItem id="send" textValue={t('kanban.scheduleSend')}>{t('kanban.scheduleSend')}</SelectItem>
      </Select>
      {action === 'send' ? (
        <Select
          label={t('kanban.scheduleConversation')}
          className="w-full"
          popoverClassName="w-(--trigger-width)"
          selectedKey={conversationId}
          onSelectionChange={(key) => setConversationId(String(key))}
        >
          {targets.map((conversation) => (
            <SelectItem
              key={conversation.id}
              id={conversation.id}
              textValue={conversationDisplayTitle(conversation, session.timeline)}
            >
              {conversationDisplayTitle(conversation, session.timeline)}
            </SelectItem>
          ))}
        </Select>
      ) : null}
      <Input
        label={t('kanban.scheduleAt')}
        name="schedule-at"
        type="datetime-local"
        value={at}
        onChange={(value) => { setAt(value); setError(''); }}
        hint={zone ? t('kanban.scheduleZone', { zone: kanbanTimeZoneLabel(zone) }) : t('kanban.scheduleZoneUnknown')}
      />
      <Textarea label={t('kanban.scheduleText')} value={text} onChange={setText} rows={4} maxLength={20000} />
      {error ? <p className="text-body-regular text-text-error-primary">{error}</p> : null}
    </Modal>
  );
}

/** The task board: the BoardUI project-board template (status columns, task
 * sheet, create dialog) over the kanban store, plus the schedule dialog. */
export function KanbanPanel({ session, onOpenConversation }: Props) {
  const t = useT();
  const allTasks = useKanbanTasks();
  const [schedulingTaskId, setSchedulingTaskId] = useState<string | null>(null);
  const schedulingTask = allTasks.find((task) => task.id === schedulingTaskId && !task.deletedAt) ?? null;
  // Columns list workspaces in the same manual order as the sidebar.
  const orderedWorkspaces = useMemo(() => [...session.workspaces].sort(
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
      <ScheduleTaskDialog
        session={session}
        task={schedulingTask}
        onClose={() => setSchedulingTaskId(null)}
      />
    </div>
  );
}

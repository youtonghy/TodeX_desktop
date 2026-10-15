import { useState } from 'react';
import { backendWallClockToIso } from '@todex/protocol/todex';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Modal } from '@/components/ui/modal';
import { kanbanBackendLocalTime, kanbanTimeZoneLabel, useKanbanTimeZone } from '../session/kanbanTasks';
import { useT } from '../i18n';

/** Picks the time a scheduled conversation sends at. The time is wall-clock
 * in the backend's zone, which is where it runs; `onConfirm` gets the ISO
 * instant and resolves whether it was applied. */
export function ScheduleConversationDialog({ isOpen, mode, initialAt, backendId, onConfirm, onClose }: {
  isOpen: boolean;
  /** Backend the conversation runs on (default: the focused one). */
  backendId?: string;
  mode: 'create' | 'reschedule';
  /** ISO instant to start from when rescheduling. */
  initialAt?: string;
  onConfirm: (at: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const zone = useKanbanTimeZone(backendId);
  const [at, setAt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openedWith, setOpenedWith] = useState<string | null>(null);

  // Seed on open: the current time when rescheduling, else an hour ahead.
  const openKey = isOpen ? `${mode}:${initialAt ?? ''}:${zone ? 'zone' : ''}` : null;
  if (openKey !== openedWith) {
    setOpenedWith(openKey);
    if (openKey && zone) {
      const seed = initialAt && Date.parse(initialAt) > Date.now() ? Date.parse(initialAt) : Date.now() + 60 * 60_000;
      setAt(kanbanBackendLocalTime(zone, seed));
      setError('');
      setBusy(false);
    }
  }

  const submit = async () => {
    if (!zone || busy) return;
    const iso = backendWallClockToIso(at, zone);
    if (!iso || Date.parse(iso) <= Date.now()) {
      setError(t('kanban.schedulePast'));
      return;
    }
    setBusy(true);
    const applied = await onConfirm(iso);
    setBusy(false);
    if (applied) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={mode === 'create' ? t('schedule.createTitle') : t('schedule.rescheduleTitle')}
      description={mode === 'create' ? t('schedule.hint') : undefined}
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => { void submit(); }} disabled={!zone || !at || busy}>
            {mode === 'create' ? t('schedule.confirm') : t('schedule.save')}
          </Button>
        </>
      )}
    >
      <Input
        label={t('schedule.at')}
        name="schedule-conversation-at"
        type="datetime-local"
        value={at}
        isInvalid={Boolean(error)}
        onChange={(value) => { setAt(value); setError(''); }}
        hint={error || (zone ? t('kanban.scheduleZone', { zone: kanbanTimeZoneLabel(zone) }) : t('kanban.scheduleZoneUnknown'))}
      />
    </Modal>
  );
}

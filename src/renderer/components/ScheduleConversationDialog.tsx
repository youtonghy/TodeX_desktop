import { useState } from 'react';
import { backendWallClockToIso } from '@todex/protocol/todex';
import { Button } from '@/components/base/buttons/button';
import { Input } from '@/components/base/input/input';
import { Select, SelectItem } from '@/components/base/select/select';
import type { ProviderDescriptor, ProviderKind } from '@todex/protocol/v2';
import { ProviderIcon } from './ProviderIcon';
import { Modal } from '@/components/ui/modal';
import { kanbanBackendLocalTime, kanbanTimeZoneLabel, useKanbanTimeZone } from '../session/kanbanTasks';
import { useT } from '../i18n';

/** Picks the time a scheduled conversation sends at (and, when creating
 * with `agents`, the agent it runs). The time is wall-clock in the backend's
 * zone, which is where it runs; `onConfirm` gets the ISO instant and the
 * picked agent and resolves whether it was applied. */
export function ScheduleConversationDialog({ isOpen, mode, initialAt, backendId, agents, onConfirm, onClose }: {
  isOpen: boolean;
  /** Backend the conversation runs on (default: the focused one). */
  backendId?: string;
  mode: 'create' | 'reschedule';
  /** ISO instant to start from when rescheduling. */
  initialAt?: string;
  /** Agents a new scheduled conversation can run on, and the default. */
  agents?: { providers: ProviderDescriptor[]; defaultProvider?: ProviderKind };
  onConfirm: (at: string, options: { provider?: ProviderKind }) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const zone = useKanbanTimeZone(backendId);
  const [at, setAt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openedWith, setOpenedWith] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderKind | undefined>(undefined);
  const agentChoices = mode === 'create' ? agents?.providers ?? [] : [];
  const pickedProvider = agentChoices.some((item) => item.id === provider) ? provider : agents?.defaultProvider ?? agentChoices[0]?.id;

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
    // A fresh open starts from the default agent; the zone arriving later keeps the pick.
    if (openKey && !openedWith) setProvider(agents?.defaultProvider);
  }

  const submit = async () => {
    if (!zone || busy) return;
    const iso = backendWallClockToIso(at, zone);
    if (!iso || Date.parse(iso) <= Date.now()) {
      setError(t('kanban.schedulePast'));
      return;
    }
    setBusy(true);
    const applied = await onConfirm(iso, { provider: agentChoices.length ? pickedProvider : undefined });
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
          <Button onClick={() => { void submit(); }} disabled={!zone || !at || busy || (Boolean(agents) && mode === 'create' && !pickedProvider)}>
            {mode === 'create' ? t('schedule.confirm') : t('schedule.save')}
          </Button>
        </>
      )}
    >
      {agentChoices.length ? (
        <Select
          label={t('schedule.agent')}
          selectedKey={pickedProvider ?? null}
          onSelectionChange={(key) => { if (key !== null) setProvider(String(key) as ProviderKind); }}
        >
          {agentChoices.map((item) => (
            <SelectItem key={item.id} id={item.id} textValue={item.displayName}>
              <ProviderIcon className="size-4" provider={item.id} />
              {item.displayName}
            </SelectItem>
          ))}
        </Select>
      ) : null}
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

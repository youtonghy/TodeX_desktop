import { useId, useMemo, useState } from 'react';
import { RiAddLine, RiArrowDownSLine, RiArrowUpSLine, RiCloseLine } from '@remixicon/react';
import {
  SSH_IP_MANUAL_PORT_LIMIT, countSshPorts, estimateSshListenerBytes, parseSshPortSpec,
  type SshHost, type SshIpAssignment, type SshIpPortMode, type SshIpPool,
} from '@todex/protocol/ssh';
import { useT } from '../../i18n';
import { errorMessage, formatApproxBytes, type SshApi } from './sshShared';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { LinkButton } from '@/components/base/buttons/link-button';
import { Input } from '@/components/base/input/input';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { IconAction } from '@/components/ui/icon-action';
import { Modal } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

/** Normalizes `7000 - 7010` to `7000-7010`. */
function normalizePortEntry(entry: string): string {
  return entry.replace(/\s+/g, '');
}

/** Port tags: `8080` or `7000-7010` entries, added with Enter, comma or the add button. */
function PortTagInput({ tags, limit, onChange }: { tags: string[]; limit: number; onChange: (tags: string[]) => void }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    // Collapse `7000 - 7010` before splitting on commas and whitespace.
    const entries = draft.replace(/\s*-\s*/g, '-').split(/[\s,]+/).map(normalizePortEntry).filter(Boolean);
    if (!entries.length) return;
    for (const entry of entries) {
      const parsed = parseSshPortSpec([entry], limit);
      if ('error' in parsed) {
        setError(t('ssh.ipPool.portEntryInvalid', { entry }));
        return;
      }
    }
    const next = [...tags];
    for (const entry of entries) if (!next.includes(entry)) next.push(entry);
    onChange(next);
    setDraft('');
    setError('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Input
          className="min-w-0 flex-1"
          label={t('ssh.ipPool.ports')}
          placeholder="8080, 7000-7010"
          inputDir="ltr"
          value={draft}
          onChange={(value) => { setDraft(value); setError(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              add();
            }
          }}
          isInvalid={Boolean(error)}
          hint={error || t('ssh.ipPool.portsHint')}
        />
        <Button variant="secondary" className="mt-6" leadingIcon={RiAddLine} disabled={!draft.trim()} onClick={add}>{t('ssh.ipPool.addPort')}</Button>
      </div>
      {tags.length ? (
        <div className="flex flex-wrap gap-1.5" dir="ltr">
          {tags.map((tag) => (
            <Chip key={tag} variant="caption" color="gray" className="gap-0.5 pe-0.5 font-mono">
              {tag}
              <IconAction
                icon={RiCloseLine}
                size="xs"
                aria-label={t('ssh.ipPool.removePort', { entry: tag })}
                onClick={() => onChange(tags.filter((item) => item !== tag))}
              />
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Assign a loopback IP to a host, or change an assignment's ports. */
export function SshIpAssignmentDialog({ api, hosts, pool, assignment, initialAlias, onClose, onSaved }: {
  api: SshApi;
  hosts: SshHost[];
  pool: SshIpPool;
  /** Editing ports when set; the IP and host stay fixed. */
  assignment?: SshIpAssignment;
  initialAlias?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const modeLabelId = useId();
  const limit = pool.manualPortLimit || SSH_IP_MANUAL_PORT_LIMIT;
  const assigned = new Set(pool.assignments.map((item) => item.alias));
  const freeHosts = hosts.filter((host) => !assigned.has(host.alias));
  const [alias, setAlias] = useState(assignment?.alias ?? (initialAlias && !assigned.has(initialAlias) ? initialAlias : freeHosts[0]?.alias ?? ''));
  const [ip, setIp] = useState('');
  const [portMode, setPortMode] = useState<SshIpPortMode>(assignment?.portMode ?? 'auto');
  const [ports, setPorts] = useState<string[]>(assignment?.ports ?? []);
  const [showAutoPorts, setShowAutoPorts] = useState(false);
  const [saving, setSaving] = useState(false);

  const autoCount = useMemo(() => countSshPorts(pool.autoPorts), [pool.autoPorts]);
  const manual = useMemo(() => parseSshPortSpec(ports, limit), [limit, ports]);
  const manualCount = 'ports' in manual ? manual.ports.length : 0;
  const count = portMode === 'auto' ? autoCount : manualCount;

  const submit = async () => {
    if (!alias) return toast.danger(t('ssh.forwards.hostRequired'));
    if (portMode === 'manual') {
      if ('error' in manual) return toast.danger(t('ssh.ipPool.tooManyPorts', { limit }));
      if (!manual.ports.length) return toast.danger(t('ssh.ipPool.portsRequired'));
    }
    const portsInput = portMode === 'manual' ? { ports } : {};
    setSaving(true);
    try {
      if (assignment) {
        await api().updateSshIpAssignment(assignment.ip, { portMode, ...portsInput });
      } else {
        const { assignment: created } = await api().createSshIpAssignment({ alias, portMode, ...(ip.trim() ? { ip: ip.trim() } : {}), ...portsInput });
        toast.success(t('ssh.ipPool.assigned', { ip: created.ip, alias }));
      }
      onSaved();
      onClose();
    } catch (error) {
      toast.danger(errorMessage(error, t('ssh.ipPool.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={assignment ? t('ssh.ipPool.editTitle', { ip: assignment.ip }) : t('ssh.ipPool.addTitle')}
      size="lg"
      className="max-h-[90vh]"
      bodyClassName="flex flex-col gap-4"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={saving} leadingIcon={saving ? SpinnerIcon : undefined} aria-busy={saving || undefined} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      )}
    >
      {assignment ? (
        <p className="text-body-regular text-text-secondary">
          {t('ssh.ipPool.editIntro', { alias: assignment.alias })} <bdi dir="ltr" className="font-mono text-text-primary">{assignment.ip}</bdi>
        </p>
      ) : (
        <>
          <Select
            label={t('ssh.forwards.host')}
            className="w-full"
            popoverClassName="w-(--trigger-width)"
            placeholder={t('ssh.forwards.hostPlaceholder')}
            hint={freeHosts.length ? undefined : t('ssh.ipPool.noFreeHosts')}
            selectedKey={alias || null}
            onSelectionChange={(key) => { if (key !== null) setAlias(String(key)); }}
          >
            {freeHosts.map((host) => <SelectItem key={host.alias} id={host.alias} textValue={host.alias}>{host.alias}</SelectItem>)}
          </Select>
          <Input
            className="w-full"
            label={t('ssh.ipPool.ip')}
            placeholder={t('ssh.ipPool.ipAuto')}
            hint={t('ssh.ipPool.ipHint', { cidr: pool.cidr })}
            inputDir="ltr"
            value={ip}
            onChange={setIp}
          />
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <span id={modeLabelId} className="text-body-medium text-text-primary">{t('ssh.ipPool.portMode')}</span>
        <SegmentedControl
          aria-labelledby={modeLabelId}
          className="self-start"
          selectedKeys={[portMode]}
          onSelectionChange={(keys) => {
            const [next] = [...keys] as SshIpPortMode[];
            if (next) setPortMode(next);
          }}
        >
          <SegmentedControlItem id="auto">{t('ssh.ipPool.modeAuto')}</SegmentedControlItem>
          <SegmentedControlItem id="manual">{t('ssh.ipPool.modeManual')}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {portMode === 'auto' ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption-1-regular text-text-tertiary">{t('ssh.ipPool.autoNote')}</p>
          <LinkButton
            size="xs"
            variant="secondary"
            className="self-start"
            trailingIcon={showAutoPorts ? RiArrowUpSLine : RiArrowDownSLine}
            aria-expanded={showAutoPorts}
            onClick={() => setShowAutoPorts((current) => !current)}
          >
            {t(showAutoPorts ? 'ssh.ipPool.hideAutoPorts' : 'ssh.ipPool.showAutoPorts', { count: autoCount })}
          </LinkButton>
          {showAutoPorts ? (
            <div className="flex flex-wrap gap-1.5" dir="ltr">
              {pool.autoPorts.map((entry) => <Chip key={entry} variant="caption" color="neutral" className="font-mono">{entry}</Chip>)}
            </div>
          ) : null}
        </div>
      ) : (
        <PortTagInput tags={ports} limit={limit} onChange={setPorts} />
      )}
      {portMode === 'manual' && 'error' in manual ? (
        <p className="text-caption-1-regular text-text-error-primary">{t('ssh.ipPool.tooManyPorts', { limit })}</p>
      ) : (
        <p className="text-caption-1-regular text-text-secondary">
          {t('ssh.ipPool.memoryEstimate', { count, memory: formatApproxBytes(estimateSshListenerBytes(count)) })}
        </p>
      )}
    </Modal>
  );
}

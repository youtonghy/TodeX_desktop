import { Select, SelectItem } from '@/components/base/select/select';
import { cx } from '@/utils/cx';
import { useT } from '../../i18n';
import { backendLabelColor, type BackendConnectionProfile } from '../../session/backendColors';

/** Value of the "every backend" entry (`allLabel`). */
export const ALL_BACKENDS = '__all__';

export interface BackendSelectProps {
  profiles: readonly BackendConnectionProfile[];
  /** Connection state by profile id; anything but 'open' reads "Not connected". */
  linkStates?: Record<string, { state: string } | undefined>;
  selectedId: string;
  onChange: (backendId: string) => void;
  /** Adds an "every backend" entry first, selected as `ALL_BACKENDS`. */
  allLabel?: string;
  isDisabled?: boolean;
  className?: string;
}

function BackendDot({ profile }: { profile?: BackendConnectionProfile }) {
  return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full ring-1 ring-separator-border" style={{ backgroundColor: backendLabelColor(profile) }} />;
}

/**
 * Picks the backend a workspace-less panel acts on: each backend's label
 * color, name and URL, flagged when it is not connected. Renders nothing
 * with a single backend (and no `allLabel`), where there is nothing to pick.
 */
export function BackendSelect({ profiles: allProfiles, linkStates, selectedId, onChange, allLabel, isDisabled, className }: BackendSelectProps) {
  const t = useT();
  // A disabled profile's backend is picked through the profile serving it.
  const profiles = allProfiles.filter((profile) => !profile.disabled);
  if (profiles.length < 2) return null;
  return (
    <Select
      aria-label={t('backendSelect.label')}
      size="sm"
      isDisabled={isDisabled}
      className={cx('w-56 max-w-full shrink-0', className)}
      popoverClassName="w-72"
      selectedKey={selectedId}
      onSelectionChange={(key) => { if (typeof key === 'string') onChange(key); }}
    >
      {allLabel ? <SelectItem id={ALL_BACKENDS} textValue={allLabel}>{allLabel}</SelectItem> : null}
      {profiles.map((profile) => {
        const offline = linkStates ? linkStates[profile.id]?.state !== 'open' : false;
        return (
          <SelectItem key={profile.id} id={profile.id} textValue={profile.name}>
            <BackendDot profile={profile} />
            <span className="min-w-0 flex-1 truncate" title={profile.serverUrl}>{profile.name}</span>
            {offline ? <span className="shrink-0 text-caption-1-regular text-text-tertiary">{t('backendSelect.disconnected')}</span> : null}
          </SelectItem>
        );
      })}
    </Select>
  );
}

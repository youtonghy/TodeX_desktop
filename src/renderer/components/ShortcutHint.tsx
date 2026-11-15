import { Kbd } from '@/components/base/kbd/kbd';
import { cx } from '@/utils/cx';
import { shortcutKeys, type ShortcutId } from '../lib/shortcuts';

/** `compact` drops the held modifier, for badges too small for the full combination. */
export function ShortcutHint({ id, compact = false, className }: { id: ShortcutId; compact?: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('shortcut-hint', className)}>
      <Kbd className="shortcut-hint__kbd">{shortcutKeys(id, { omitMod: compact })}</Kbd>
    </span>
  );
}

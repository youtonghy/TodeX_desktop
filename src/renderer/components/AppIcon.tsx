import { cx } from '@/utils/cx';
import darkIcon from '../assets/brand/t-icon-dark-beige.png';
import lightIcon from '../assets/brand/t-icon-light.png';

// Decorative brand mark: each placement already includes the TodeX name.
// The light and dark artwork swap with the theme class.
export function AppIcon({ className = 'size-8' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cx('inline-flex shrink-0 select-none', className)}>
      <img src={lightIcon} alt="" draggable={false} className="size-full object-contain dark:hidden" />
      <img src={darkIcon} alt="" draggable={false} className="hidden size-full object-contain dark:block" />
    </span>
  );
}

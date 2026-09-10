import { Avatar } from '@heroui/react';
import darkIcon from '../assets/brand/t-icon-dark-beige.png';
import lightIcon from '../assets/brand/t-icon-light.png';

// Decorative brand mark: each placement already includes the TodeX name.
export function AppIcon({ className = 'size-8' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 ${className}`}>
      <Avatar className="size-full rounded-none bg-transparent dark:hidden">
        <Avatar.Image src={lightIcon} alt="" draggable={false} />
        <Avatar.Fallback className="bg-transparent">T</Avatar.Fallback>
      </Avatar>
      <Avatar className="hidden size-full rounded-none bg-transparent dark:flex">
        <Avatar.Image src={darkIcon} alt="" draggable={false} />
        <Avatar.Fallback className="bg-transparent">T</Avatar.Fallback>
      </Avatar>
    </span>
  );
}

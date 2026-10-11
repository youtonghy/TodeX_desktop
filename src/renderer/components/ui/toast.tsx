import { useSyncExternalStore, type ReactNode } from 'react';
import { Notification, NotificationViewport, type NotificationStatus } from '@/components/base/notification/notification';
import { useT } from '@/i18n';
import { addNotification, type FeedStatus } from '@/session/notificationFeed';

/**
 * App-wide toasts on the BoardUI Notification card. `toast.success(...)`
 * and friends work from anywhere (no hook); `<ToastViewport />` renders the
 * stack once near the app root.
 */

export type ToastVariant = 'default' | 'info' | 'success' | 'warning' | 'danger';

export type ToastAction = {
  children: ReactNode;
  onPress?: () => void;
  isDisabled?: boolean;
  isPending?: boolean;
};

export type ToastOptions = {
  description?: ReactNode;
  /** Milliseconds before it leaves on its own; 0 keeps it until dismissed. */
  timeout?: number;
  actionProps?: ToastAction;
};

type ToastItem = ToastOptions & {
  key: string;
  title: ReactNode;
  variant: ToastVariant;
  closing: boolean;
};

const DEFAULT_TIMEOUT = 5000;
const MAX_VISIBLE = 4;
const STATUS: Record<ToastVariant, NotificationStatus> = {
  default: 'neutral',
  info: 'information',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

const FEED_STATUS: Record<ToastVariant, FeedStatus> = {
  default: 'neutral',
  info: 'information',
  success: 'success',
  warning: 'neutral',
  danger: 'error',
};

let items: ToastItem[] = [];
let counter = 0;
const listeners = new Set<() => void>();

function emit(next: ToastItem[]) {
  items = next;
  listeners.forEach((listener) => listener());
}

function show(variant: ToastVariant, title: ReactNode, options: ToastOptions = {}): string {
  counter += 1;
  const key = `toast-${counter}`;
  emit([...items, { ...options, key, title, variant, closing: false }]);
  // Every notice also lands in the sidebar's notification history.
  if (typeof title === 'string') {
    addNotification({
      kind: 'system',
      status: FEED_STATUS[variant],
      title,
      description: typeof options.description === 'string' ? options.description : '',
    });
  }
  return key;
}

function close(key: string) {
  if (!items.some((item) => item.key === key && !item.closing)) return;
  emit(items.map((item) => item.key === key ? { ...item, closing: true } : item));
}

function remove(key: string) {
  emit(items.filter((item) => item.key !== key));
}

type ToastFn = ((title: ReactNode, options?: ToastOptions) => string) & {
  info: (title: ReactNode, options?: ToastOptions) => string;
  success: (title: ReactNode, options?: ToastOptions) => string;
  warning: (title: ReactNode, options?: ToastOptions) => string;
  danger: (title: ReactNode, options?: ToastOptions) => string;
  close: (key: string) => void;
};

export const toast: ToastFn = Object.assign(
  (title: ReactNode, options?: ToastOptions) => show('default', title, options),
  {
    info: (title: ReactNode, options?: ToastOptions) => show('info', title, options),
    success: (title: ReactNode, options?: ToastOptions) => show('success', title, options),
    warning: (title: ReactNode, options?: ToastOptions) => show('warning', title, options),
    danger: (title: ReactNode, options?: ToastOptions) => show('danger', title, options),
    close,
  },
);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ToastViewport() {
  const t = useT();
  const current = useSyncExternalStore(subscribe, () => items);
  return (
    <NotificationViewport position="bottom-end" aria-label={t('common.notifications')}>
      {current.slice(-MAX_VISIBLE).map((item) => {
        const timeout = item.timeout ?? DEFAULT_TIMEOUT;
        const action = item.actionProps;
        return (
          <Notification
            key={item.key}
            introDelay={0}
            title={item.title}
            description={item.description}
            status={STATUS[item.variant]}
            closeLabel={t('common.dismiss')}
            autoDismissDuration={timeout > 0 ? timeout : undefined}
            isDismissed={item.closing}
            onDismiss={() => remove(item.key)}
            actions={action ? [{
              label: action.children,
              variant: 'secondary',
              disabled: action.isDisabled || action.isPending,
              onClick: () => action.onPress?.(),
            }] : undefined}
          />
        );
      })}
    </NotificationViewport>
  );
}

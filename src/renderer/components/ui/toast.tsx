import { useSyncExternalStore } from 'react';
import { Notification, NotificationViewport, type NotificationStatus } from '@/components/base/notification/notification';
import { useT } from '@/i18n';
import { getToastItems, remove, subscribe, type ToastVariant } from './toast-store';

/**
 * App-wide toasts on the BoardUI Notification card. `toast.success(...)`
 * (from `./toast-store`) and friends work from anywhere (no hook);
 * `<ToastViewport />` renders the stack once near the app root.
 */

const DEFAULT_TIMEOUT = 5000;
const MAX_VISIBLE = 4;
const STATUS: Record<ToastVariant, NotificationStatus> = {
  default: 'neutral',
  info: 'information',
  success: 'success',
  warning: 'warning',
  danger: 'error',
};

export function ToastViewport() {
  const t = useT();
  const current = useSyncExternalStore(subscribe, getToastItems);
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

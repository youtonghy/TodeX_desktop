import { useEffect, useRef } from 'react';
import { toast } from '@heroui/react';

type NoticeOptions = {
  variant?: 'info' | 'success' | 'warning' | 'danger';
  description?: string;
  scope?: string;
  timeout?: number;
  actionLabel?: string;
  actionPending?: boolean;
  actionDisabled?: boolean;
  onAction?: () => void;
};

/** Show state changes once; dismiss stale notices when their source changes. */
export function useNoticeToast(message: string | null | undefined, {
  variant = 'warning', description, scope, timeout = 6000,
  actionLabel, actionPending, actionDisabled, onAction,
}: NoticeOptions = {}) {
  const onActionRef = useRef(onAction);
  useEffect(() => { onActionRef.current = onAction; });
  useEffect(() => {
    if (!message) return;
    let key: string | undefined;
    // Defer until mount settles so StrictMode's effect replay cannot notify twice.
    const timer = window.setTimeout(() => {
      key = toast[variant](message, {
        description, timeout,
        ...(actionLabel ? { actionProps: {
          size: 'sm' as const,
          isPending: actionPending,
          isDisabled: actionDisabled,
          onPress: () => onActionRef.current?.(),
          children: actionLabel,
        } } : {}),
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (key !== undefined) toast.close(key);
    };
  }, [message, variant, description, scope, timeout, actionLabel, actionPending, actionDisabled]);
}

export function NoticeToast({ message, ...options }: NoticeOptions & { message?: string | null }) {
  useNoticeToast(message, options);
  return null;
}

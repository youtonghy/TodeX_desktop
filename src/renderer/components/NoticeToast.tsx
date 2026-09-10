import { useEffect } from 'react';
import { toast } from '@heroui/react';

type NoticeOptions = {
  variant?: 'info' | 'success' | 'warning' | 'danger';
  description?: string;
  scope?: string;
  timeout?: number;
};

/** Show state changes once; dismiss stale notices when their source changes. */
export function useNoticeToast(message: string | null | undefined, {
  variant = 'warning', description, scope, timeout = 6000,
}: NoticeOptions = {}) {
  useEffect(() => {
    if (!message) return;
    let key: string | undefined;
    // Defer until mount settles so StrictMode's effect replay cannot notify twice.
    const timer = window.setTimeout(() => {
      key = toast[variant](message, { description, timeout });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (key !== undefined) toast.close(key);
    };
  }, [message, variant, description, scope, timeout]);
}

export function NoticeToast({ message, ...options }: NoticeOptions & { message?: string | null }) {
  useNoticeToast(message, options);
  return null;
}

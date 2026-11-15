import { useNoticeToast, type NoticeOptions } from './useNoticeToast';

export function NoticeToast({ message, ...options }: NoticeOptions & { message?: string | null }) {
  useNoticeToast(message, options);
  return null;
}

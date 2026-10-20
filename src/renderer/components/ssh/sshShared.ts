import type { SshFailureKind } from '@todex/protocol/ssh';
import type { V2ApiClient } from '@todex/protocol/v2';
import type { MessageKey } from '../../i18n';
import { toast } from '@/components/ui/toast';

export type SshApi = () => V2ApiClient;

export const SSH_FAILURE_LABEL_KEYS: Record<SshFailureKind, MessageKey> = {
  hostKeyUnverified: 'ssh.failure.hostKeyUnverified',
  hostKeyChanged: 'ssh.failure.hostKeyChanged',
  authenticationFailed: 'ssh.failure.authenticationFailed',
  unreachable: 'ssh.failure.unreachable',
  timedOut: 'ssh.failure.timedOut',
  other: 'ssh.failure.other',
};

export const SSH_FAILURE_HINT_KEYS: Record<SshFailureKind, MessageKey> = {
  hostKeyUnverified: 'ssh.hint.hostKeyUnverified',
  hostKeyChanged: 'ssh.hint.hostKeyChanged',
  authenticationFailed: 'ssh.hint.authenticationFailed',
  unreachable: 'ssh.hint.unreachable',
  timedOut: 'ssh.hint.timedOut',
  other: 'ssh.hint.other',
};

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Backend timestamps are epoch milliseconds; tolerate seconds as well. */
export function formatTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Date(value < 1e12 ? value * 1000 : value).toLocaleString();
}

/** Parses an optional TCP port field; `null` means invalid input. */
export function parsePort(value: string): number | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const port = Number(trimmed);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** Formats an optional RFC3339 timestamp from the backend. */
export function formatIsoTimestamp(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/** `3.7 KB`, `14.5 MB`: rough sizes for estimates. */
export function formatApproxBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function copyText(text: string, done: string, failed: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.danger(failed);
  }
}

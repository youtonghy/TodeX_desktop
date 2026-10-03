import type { SshFailureKind } from '@todex/protocol/ssh';
import type { V2ApiClient } from '@todex/protocol/v2';
import type { MessageKey } from '../../i18n';

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

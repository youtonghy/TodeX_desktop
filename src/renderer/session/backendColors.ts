import type { BackendConnectionProfile as ProtocolBackendConnectionProfile } from '@todex/protocol/todex';
import { t } from '../i18n';

export type BackendConnectionProfile = ProtocolBackendConnectionProfile & { labelColor?: string };

export const BACKEND_LABEL_COLORS = [
  { value: '#3b82f6', get label() { return t('color.blue'); } },
  { value: '#8b5cf6', get label() { return t('color.purple'); } },
  { value: '#ec4899', get label() { return t('color.pink'); } },
  { value: '#ef4444', get label() { return t('color.red'); } },
  { value: '#f97316', get label() { return t('color.orange'); } },
  { value: '#eab308', get label() { return t('color.yellow'); } },
  { value: '#22c55e', get label() { return t('color.green'); } },
  { value: '#06b6d4', get label() { return t('color.cyan'); } },
] as const;

export function normalizeBackendLabelColor(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

export function backendLabelColor(profile: BackendConnectionProfile | undefined): string {
  if (!profile) return '#71717a';
  const savedColor = normalizeBackendLabelColor(profile.labelColor);
  if (savedColor) return savedColor;
  let hash = 0;
  for (const character of profile.id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return BACKEND_LABEL_COLORS[hash % BACKEND_LABEL_COLORS.length].value;
}

import type { BackendConnectionProfile as ProtocolBackendConnectionProfile } from '@todex/protocol/todex';

export type BackendConnectionProfile = ProtocolBackendConnectionProfile & { labelColor?: string };

export const BACKEND_LABEL_COLORS = [
  { value: '#3b82f6', label: '蓝色' },
  { value: '#8b5cf6', label: '紫色' },
  { value: '#ec4899', label: '粉色' },
  { value: '#ef4444', label: '红色' },
  { value: '#f97316', label: '橙色' },
  { value: '#eab308', label: '黄色' },
  { value: '#22c55e', label: '绿色' },
  { value: '#06b6d4', label: '青色' },
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

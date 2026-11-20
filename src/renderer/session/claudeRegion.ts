export type ClaudeRegionBlock =
  | { kind: 'unsupported'; region?: string }
  | { kind: 'unverified' }
  | { kind: 'upgrade' };

const UNSUPPORTED_MESSAGE = /^Claude Code is not available in the detected region \(([A-Z]{2})\)$/;

/** Accept daemon codes from WS payloads, command rejections and HTTP errors. */
export function claudeRegionError(error: unknown): ClaudeRegionBlock | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { code, backendCode, region, message } = error as {
    code?: unknown; backendCode?: unknown; region?: unknown; message?: unknown;
  };
  switch (backendCode ?? code) {
    case 'CLAUDE_REGION_UNSUPPORTED': {
      const safeRegion = typeof region === 'string' && /^[A-Z]{2}$/.test(region)
        ? region : typeof message === 'string' ? UNSUPPORTED_MESSAGE.exec(message)?.[1] : undefined;
      return { kind: 'unsupported', region: safeRegion };
    }
    case 'CLAUDE_REGION_UNVERIFIED': return { kind: 'unverified' };
    default: return undefined;
  }
}

export function claudeRegionCapability(
  provider: string | undefined,
  descriptors: readonly { id: string; capabilities: { claudeRegionPreflight?: boolean } }[] | undefined,
): 'unverified' | 'upgrade' | undefined {
  if (provider !== 'claude-code') return undefined;
  const descriptor = descriptors?.find(item => item.id === provider);
  if (!descriptor) return 'unverified';
  return descriptor.capabilities.claudeRegionPreflight === true ? undefined : 'upgrade';
}

import type { ProviderCommandDescriptor, ProviderCommandsResponse } from '@todex/protocol/v2';
import { t } from '../i18n';

export type CommandContext = {
  backend: string; workspace: string; provider: string; conversationId?: string;
  runtimeId?: string; runtimeStatus?: string; nativeSessionId?: string; commandEpoch?: number;
};
export type ProviderCommandCatalog = {
  contextKey: string; status: 'loading' | 'ready' | 'error'; commands: ProviderCommandDescriptor[];
  error?: string; source?: ProviderCommandsResponse['catalogSource'];
};
export const commandContextKey = (context: CommandContext) => JSON.stringify([
  context.backend, context.workspace, context.provider, context.conversationId ?? '',
  context.runtimeId ?? '', context.runtimeStatus ?? '', context.nativeSessionId ?? '', context.commandEpoch ?? 0,
]);

/** This is a versioned evidence registry, not an inference from command names. */
export function piCommandCompatibility(command: ProviderCommandDescriptor, args = ''): { label: string; blocked?: string } {
  const identity = `${command.packageName ?? ''}@${command.packageVersion ?? ''}/${command.name}`;
  const subcommand = args.trim().split(/\s+/)[0];
  const terminal = t('piExt.terminalBlocked');
  switch (identity) {
    case 'pi-cache-graph@1.0.2/cache': return { label: t('piExt.compatCache'),
      ...(['graph', 'stats'].includes(subcommand) ? { blocked: terminal } : {}) };
    case '@tmustier/pi-usage-extension@0.9.4/usage': return { label: t('piExt.compatNeedsTerminal'), blocked: terminal };
    case 'better-custom@0.4.1/better-custom': return { label: t('piExt.compatNeedsTerminal'), blocked: terminal };
    case 'pi-context-usage@1.0.2/context': return { label: t('piExt.compatContextUsage'),
      ...(subcommand === 'details' ? { blocked: terminal } : {}) };
    case 'pi-context-prune@1.4.0/pruner': return { label: t('piExt.compatContextPrune'),
      ...(['settings', 'tree'].includes(subcommand) ? { blocked: terminal } : {}) };
    case '@tintinweb/pi-tasks@0.9.0/tasks': return { label: t('piExt.compatTasks') };
    case 'pi-mcp-adapter@2.32.1/mcp': return { label: t('piExt.compatMcp') };
    default: return { label: t('piExt.compatUnknown') };
  }
}

const todexCommands = ['compact', 'retry', 'resume', 'memory', 'commands'] as const;
const piTodexDescriptions: Record<(typeof todexCommands)[number], () => string> = {
  compact: () => t('piExt.todexCompact'), retry: () => t('piExt.todexRetry'), resume: () => t('piExt.todexResume'),
  memory: () => t('piExt.todexMemory'), commands: () => t('piExt.todexCommands'),
};
export const piTodexCommands = todexCommands.map(name => ({ command: `/todex ${name}`, title: name,
  get description() { return piTodexDescriptions[name](); },
  category: 'context' as const }));

export function routePiSlashCommand(input: string, catalog?: ProviderCommandCatalog):
  | { kind: 'native'; input: string } | { kind: 'todex'; command: string }
  | { kind: 'blocked'; message: string } {
  const [name, ...args] = input.trim().slice(1).split(/\s+/);
  // The reserved explicit namespace stays usable while discovery is unavailable.
  if (name === 'todex') {
    const command = args[0];
    return todexCommands.some(item => item === command) && args.length === 1
      ? { kind: 'todex', command }
      : { kind: 'blocked', message: t('piExt.todexUsage') };
  }
  if (!catalog || catalog.status !== 'ready') return { kind: 'blocked', message: catalog?.status === 'error'
    ? t('piExt.catalogError') : t('piExt.catalogLoading') };
  const command = catalog.commands.find(item => item.name === name && item.invocation === 'prompt');
  if (!command) return { kind: 'blocked', message: t('piExt.noCommand', { name }) };
  const compatibility = piCommandCompatibility(command, args.join(' '));
  return compatibility.blocked ? { kind: 'blocked', message: compatibility.blocked } : { kind: 'native', input };
}

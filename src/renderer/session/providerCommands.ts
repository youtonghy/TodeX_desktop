import type { ProviderCommandDescriptor, ProviderCommandsResponse } from '@todex/protocol/v2';

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
  const terminal = '此入口依赖 Pi 终端界面，当前 RPC 无法显示。请在 Pi 终端使用此功能。';
  switch (identity) {
    case 'pi-cache-graph@1.0.2/cache': return { label: '已验证 export；graph/stats 需终端',
      ...(['graph', 'stats'].includes(subcommand) ? { blocked: terminal } : {}) };
    case '@tmustier/pi-usage-extension@0.9.4/usage': return { label: '需 Pi 终端界面', blocked: terminal };
    case 'better-custom@0.4.1/better-custom': return { label: '需 Pi 终端界面', blocked: terminal };
    case 'pi-context-usage@1.0.2/context': return { label: '部分可用：details 需终端',
      ...(subcommand === 'details' ? { blocked: terminal } : {}) };
    case 'pi-context-prune@1.4.0/pruner': return { label: '已验证 stats；settings/tree 需终端',
      ...(['settings', 'tree'].includes(subcommand) ? { blocked: terminal } : {}) };
    case '@tintinweb/pi-tasks@0.9.0/tasks': return { label: '已验证创建/查看；Settings 需终端' };
    case 'pi-mcp-adapter@2.32.1/mcp': return { label: '已验证空配置通知；其他流程未验证' };
    default: return { label: '兼容性未验证' };
  }
}

const todexCommands = ['compact', 'retry', 'resume', 'memory', 'commands'] as const;
export const piTodexCommands = todexCommands.map(name => ({ command: `/todex ${name}`, title: name,
  description: ({ compact: 'Todex 压缩上下文（会重启插件）', retry: 'Todex 重试', resume: 'Todex 继续', memory: 'Todex 记忆管理', commands: '刷新插件命令目录' })[name],
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
      : { kind: 'blocked', message: '使用 /todex compact、retry、resume、memory 或 commands。' };
  }
  if (!catalog || catalog.status !== 'ready') return { kind: 'blocked', message: catalog?.status === 'error'
    ? 'Pi 命令目录加载失败，请刷新目录后重试。草稿已保留。' : 'Pi 命令目录正在加载，请稍后重试。草稿已保留。' };
  const command = catalog.commands.find(item => item.name === name && item.invocation === 'prompt');
  if (!command) return { kind: 'blocked', message: `当前 Pi 会话没有 /${name} 命令。可刷新目录，Todex 操作请使用 /todex。` };
  const compatibility = piCommandCompatibility(command, args.join(' '));
  return compatibility.blocked ? { kind: 'blocked', message: compatibility.blocked } : { kind: 'native', input };
}

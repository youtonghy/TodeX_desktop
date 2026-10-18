import { AGENT_CALLING_SERVER, AGENT_CALLING_TOOLS, AGENT_CALLING_TOOL_ENDPOINTS } from '@todex/protocol/agentCalling';
import type { AgentCallingSettings } from '@todex/protocol/v2';
import { Markdown } from '@/components/ui/markdown';
import { useT } from '../../i18n';
import { baseMarkdownComponents } from '../markdownComponents';
import { SettingsCard, SettingsGroup, SettingsNote } from '../settings/SettingsRows';

/** Single-quoted shell word. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** JSON body inside a single-quoted shell word. */
function jsonBody(value: Record<string, unknown>): string {
  return shellQuote(JSON.stringify(value));
}

/**
 * Block 4 of Agent Calling: how to call agents from a terminal through the
 * external API. Examples use the first allowed agent and the current
 * workspace; the key is always the `$TODEX_API_KEY` placeholder.
 */
export function CliUsageGuide({ listener, agent, workspace }: {
  listener: AgentCallingSettings['apiListener'];
  /** First allowed agent, or '' when none is. */
  agent: string;
  workspace: string;
}) {
  const t = useT();
  const baseUrl = listener.baseUrl ?? `http://${listener.host}:${listener.port}/api/v1`;
  const exampleAgent = agent || 'codex';
  const exampleWorkspace = workspace || '/path/to/workspace';
  const task = t('agentCalling.cliExampleTask');
  const endpoints: Array<[string, string, string]> = [
    ['GET', '/agents', t('agentCalling.cliEndpointAgents')],
    ['GET', '/agents/{agent}/models?workspace=', t('agentCalling.cliEndpointModels')],
    ['POST', '/runs', t('agentCalling.cliEndpointRuns')],
    ['POST', '/conversations', t('agentCalling.cliEndpointCreate')],
    ['POST', '/conversations/{id}/turns', t('agentCalling.cliEndpointTurns')],
    ['GET', '/conversations/{id}/events/stream', t('agentCalling.cliEndpointStream')],
    ['POST', '/conversations/{id}/cancel', t('agentCalling.cliEndpointCancel')],
    ['POST', '/conversations/{id}/permissions/{permissionId}', t('agentCalling.cliEndpointPermission')],
  ];
  const mapping = AGENT_CALLING_TOOLS.map(tool => {
    const endpoint = AGENT_CALLING_TOOL_ENDPOINTS[tool];
    return `| \`${tool}\` | ${endpoint ? `\`${endpoint}\`` : t('agentCalling.cliNoEndpoint')} |`;
  });
  const markdown = [
    `**${t('agentCalling.cliBaseUrl')}** \`${baseUrl}\``,
    '',
    `**${t('agentCalling.cliAuth')}** \`Authorization: Bearer $TODEX_API_KEY\``,
    '',
    `| ${t('agentCalling.cliMethod')} | ${t('agentCalling.cliPath')} | ${t('agentCalling.cliPurpose')} |`,
    '| --- | --- | --- |',
    ...endpoints.map(([method, path, purpose]) => `| ${method} | \`${path}\` | ${purpose} |`),
    '',
    `${t('agentCalling.cliRunsTitle')}`,
    '',
    '```bash',
    `export TODEX_API_KEY='tdx_...'  # ${t('agentCalling.cliKeyComment')}`,
    `curl -sS ${shellQuote(`${baseUrl}/runs`)} \\`,
    '  -H "Authorization: Bearer $TODEX_API_KEY" \\',
    "  -H 'Content-Type: application/json' \\",
    `  -d ${jsonBody({ agent: exampleAgent, workspace: exampleWorkspace, text: task })}`,
    '```',
    '',
    `${t('agentCalling.cliStreamTitle')}`,
    '',
    '```bash',
    `curl -N ${shellQuote(`${baseUrl}/runs`)} \\`,
    '  -H "Authorization: Bearer $TODEX_API_KEY" \\',
    "  -H 'Content-Type: application/json' \\",
    `  -d ${jsonBody({ agent: exampleAgent, workspace: exampleWorkspace, text: task, stream: true })}`,
    '```',
    '',
    t('agentCalling.cliMappingIntro', { server: AGENT_CALLING_SERVER }),
    '',
    `| ${t('agentCalling.cliMcpTool')} | ${t('agentCalling.cliEndpoint')} |`,
    '| --- | --- |',
    ...mapping,
  ].join('\n');
  return (
    <SettingsGroup label={t('agentCalling.cliTitle')} description={t('agentCalling.cliHint')}>
      <SettingsCard>
        {listener.baseUrl ? null : (
          <SettingsNote tone="warning">{t('agentCalling.cliNotListening')}</SettingsNote>
        )}
        {!agent ? <SettingsNote tone="warning">{t('agentCalling.cliNoAgent')}</SettingsNote> : null}
        <div className="min-w-0 py-3 pe-3">
          <Markdown className="markdown-compact" components={baseMarkdownComponents}>{markdown}</Markdown>
        </div>
      </SettingsCard>
    </SettingsGroup>
  );
}

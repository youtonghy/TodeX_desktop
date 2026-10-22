import type { RemoteFilesBinding } from '../session/fileSources';

export type DesktopPanel =
  | 'settings'
  /** The user's profile (usage); renders as the main content inside AppLayout. */
  | 'profile'
  | 'slash-commands'
  | 'slash-action'
  | 'git-diff'
  | 'terminal'
  | 'browser'
  | 'files'
  | 'experimental'
  | 'v2'
  /** Workbench tab with the subagent runs of one conversation. */
  | 'subagents'
  /** Workbench tab with the agents one conversation called (Agent Calling). */
  | 'agent-calls'
  | 'kanban'
  /** Read-only Workbench tab following one agent `ssh_exec` call. */
  | 'ssh-exec'
  /** The agent's desktop browser for one conversation (desktop: live; web: screenshots). */
  | 'agent-browser'
  /** SSH hosts, keys and connections; renders as the main content inside AppLayout. */
  | 'ssh';

export type WorkbenchTab = 'terminal' | 'browser' | 'files' | 'git-diff' | 'ssh-exec' | 'subagents' | 'agent-calls' | 'agent-browser';

export type OpenPanelOptions = {
  workspaceId?: string;
  conversationId?: string;
  command?: string;
  url?: string;
  filePath?: string;
};

export function isWorkbenchTab(panel: DesktopPanel | null): panel is WorkbenchTab {
  return panel === 'terminal' || panel === 'browser' || panel === 'files' || panel === 'git-diff' || panel === 'ssh-exec' || panel === 'subagents' || panel === 'agent-calls' || panel === 'agent-browser';
}

/** Agent SSH, Subagents and Agent calls tabs are opened by the agent's own
 * calls only: they are not in the + menu and cannot be closed. */
export function isSystemWorkbenchTab(tab: WorkbenchTab): boolean {
  return tab === 'ssh-exec' || tab === 'subagents' || tab === 'agent-calls';
}

export function panelFromRoute(name: string): DesktopPanel | null {
  switch (name) {
    case 'Settings':
      return 'settings';
    // Plan quota shows on each agent's context card in the composer now.
    case 'Profile':
    case 'Usage':
    case 'Quota':
      return 'profile';
    case 'SlashCommands':
      return 'slash-commands';
    case 'SlashCommandAction':
      return 'slash-action';
    case 'GitDiff':
      return 'git-diff';
    case 'Terminal':
      return 'terminal';
    case 'Browser':
      return 'browser';
    case 'Files':
      return 'files';
    case 'Experimental':
      return 'experimental';
    case 'V2Conversations':
      return 'v2';
    case 'Kanban':
      return 'kanban';
    case 'Ssh':
      return 'ssh';
    default:
      return null;
  }
}

/** One tab in the Workbench side panel. `ssh` binds a terminal tab to
 * `ssh -tt <host>`; `remote` binds a files tab to a remote SFTP/FTP
 * connection instead of the active workspace; `sshExec` binds the session-only
 * `ssh-exec` tab to the agent SSH call log of one conversation, and
 * `subagents` the session-only `subagents` tab to its subagent runs, and
 * `agentCalls` the session-only `agent-calls` tab to the agents it called. */
export type WorkbenchItem = {
  id: string;
  type: WorkbenchTab;
  title: string;
  target?: OpenPanelOptions;
  ssh?: { host: string };
  remote?: RemoteFilesBinding;
  sshExec?: { conversationId: string };
  subagents?: { conversationId: string };
  agentCalls?: { conversationId: string };
  /** Session-only `agent-browser` tab of one conversation. */
  agentBrowser?: { conversationId: string };
};

/** Imperative requests from outside the Workbench (the SSH view, or a new
 * agent `ssh_exec` call, subagent or agent call in the viewed conversation), applied in id order once
 * the tab list has been restored. */
export type WorkbenchRequest =
  | { id: number; kind: 'ssh-terminal'; host: string }
  | { id: number; kind: 'remote-files'; remote: RemoteFilesBinding }
  /** A new browser tab on a loopback URL (the SSH view's running forwards). */
  | { id: number; kind: 'browser'; url: string }
  | { id: number; kind: 'ssh-exec'; conversationId: string }
  | { id: number; kind: 'subagents'; conversationId: string }
  | { id: number; kind: 'agent-calls'; conversationId: string }
  | { id: number; kind: 'agent-browser'; conversationId: string }
  | { id: number; kind: 'close'; itemId: string };

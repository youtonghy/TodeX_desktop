import type { RemoteFilesBinding } from '../session/fileSources';

export type DesktopPanel =
  | 'settings'
  | 'usage'
  | 'about'
  | 'cli-manager'
  | 'agent-providers'
  | 'slash-commands'
  | 'slash-action'
  | 'git-diff'
  | 'terminal'
  | 'browser'
  | 'files'
  | 'capabilities'
  | 'experimental'
  | 'v2'
  | 'subagents'
  | 'kanban'
  /** SSH hosts, keys and connections; renders as the main content inside AppLayout. */
  | 'ssh';

export type WorkbenchTab = 'terminal' | 'browser' | 'files' | 'git-diff';

export type OpenPanelOptions = {
  workspaceId?: string;
  conversationId?: string;
  command?: string;
  url?: string;
  filePath?: string;
};

export function isWorkbenchTab(panel: DesktopPanel | null): panel is WorkbenchTab {
  return panel === 'terminal' || panel === 'browser' || panel === 'files' || panel === 'git-diff';
}

export function panelFromRoute(name: string): DesktopPanel | null {
  switch (name) {
    case 'Settings':
      return 'settings';
    case 'Usage':
      return 'usage';
    case 'About':
      return 'about';
    case 'CliManager':
      return 'cli-manager';
    case 'AgentProviders':
      return 'agent-providers';
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
    case 'Capabilities':
      return 'capabilities';
    case 'Experimental':
      return 'experimental';
    case 'V2Conversations':
      return 'v2';
    case 'Subagents':
      return 'subagents';
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
 * connection instead of the active workspace. */
export type WorkbenchItem = {
  id: string;
  type: WorkbenchTab;
  title: string;
  target?: OpenPanelOptions;
  ssh?: { host: string };
  remote?: RemoteFilesBinding;
};

/** Imperative requests from outside the Workbench (the SSH view), applied
 * in id order once the tab list has been restored. */
export type WorkbenchRequest =
  | { id: number; kind: 'ssh-terminal'; host: string }
  | { id: number; kind: 'remote-files'; remote: RemoteFilesBinding }
  | { id: number; kind: 'close'; itemId: string };

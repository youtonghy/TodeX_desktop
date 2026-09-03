export type DesktopPanel =
  | 'settings'
  | 'usage'
  | 'about'
  | 'cli-manager'
  | 'slash-commands'
  | 'slash-action'
  | 'git-diff'
  | 'terminal'
  | 'browser'
  | 'files'
  | 'capabilities'
  | 'experimental'
  | 'v2'
  | 'kanban';

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
    case 'Kanban':
      return 'kanban';
    default:
      return null;
  }
}

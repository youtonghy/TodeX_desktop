export type DesktopPanel =
  | 'settings'
  | 'slash-commands'
  | 'slash-action'
  | 'git-diff'
  | 'terminal'
  | 'browser'
  | 'files'
  | 'capabilities'
  | 'experimental'
  | 'v2';

export type WorkbenchTab = 'terminal' | 'browser' | 'files';

export type OpenPanelOptions = {
  workspaceId?: string;
  conversationId?: string;
  command?: string;
};

export function isWorkbenchTab(panel: DesktopPanel | null): panel is WorkbenchTab {
  return panel === 'terminal' || panel === 'browser' || panel === 'files';
}

export function panelFromRoute(name: string): DesktopPanel | null {
  switch (name) {
    case 'Settings':
      return 'settings';
    case 'SlashCommands':
      return 'slash-commands';
    case 'SlashCommandAction':
      return 'slash-action';
    case 'GitDiff':
      return 'files';
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
    default:
      return null;
  }
}

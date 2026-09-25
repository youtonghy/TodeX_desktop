import {
  RiAppsLine,
  RiBook2Line,
  RiBracesLine,
  RiBriefcase4Line,
  RiBugLine,
  RiCloudLine,
  RiCodeLine,
  RiDatabase2Line,
  RiFlaskLine,
  RiFolder3Line,
  RiFolderOpenLine,
  RiGamepadLine,
  RiGitBranchLine,
  RiGlobalLine,
  RiPaletteLine,
  RiRobot2Line,
  RiRocketLine,
  RiServerLine,
  RiStarLine,
  RiTerminalBoxLine,
  RiToolsLine,
} from '@remixicon/react';

// Semantic keys stored on WorkspaceRecord.icon so every client (desktop, web,
// mobile) can map them to its own icon set.
export const WORKSPACE_ICON_CHOICES = [
  { key: 'folder', Icon: RiFolder3Line },
  { key: 'folder-open', Icon: RiFolderOpenLine },
  { key: 'code', Icon: RiCodeLine },
  { key: 'braces', Icon: RiBracesLine },
  { key: 'terminal', Icon: RiTerminalBoxLine },
  { key: 'git', Icon: RiGitBranchLine },
  { key: 'apps', Icon: RiAppsLine },
  { key: 'briefcase', Icon: RiBriefcase4Line },
  { key: 'rocket', Icon: RiRocketLine },
  { key: 'star', Icon: RiStarLine },
  { key: 'flask', Icon: RiFlaskLine },
  { key: 'bug', Icon: RiBugLine },
  { key: 'book', Icon: RiBook2Line },
  { key: 'cloud', Icon: RiCloudLine },
  { key: 'database', Icon: RiDatabase2Line },
  { key: 'globe', Icon: RiGlobalLine },
  { key: 'tools', Icon: RiToolsLine },
  { key: 'gamepad', Icon: RiGamepadLine },
  { key: 'robot', Icon: RiRobot2Line },
  { key: 'palette', Icon: RiPaletteLine },
] as const;

export function workspaceIconComponent(icon?: string) {
  return WORKSPACE_ICON_CHOICES.find((choice) => choice.key === icon)?.Icon ?? RiFolder3Line;
}

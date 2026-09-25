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

/* Workspace status rings: five stroke-matched treatments drawn as SVG
   overlays so caps, gaps, and dots share the icon's ~1.5px stroke. 'orbit'
   is the default; any unknown key resolves to it. */
export const WORKSPACE_RING_STYLES = [
  { key: 'orbit', labelKey: 'sidebar.ringOrbit' },
  { key: 'pulse', labelKey: 'sidebar.ringPulse' },
  { key: 'ellipsis', labelKey: 'sidebar.ringEllipsis' },
  { key: 'beads', labelKey: 'sidebar.ringBeads' },
  { key: 'arc', labelKey: 'sidebar.ringArc' },
] as const;

export type WorkspaceStatusKind = 'working' | 'issue' | 'unread';

export function ringStyleKey(style?: string) {
  return WORKSPACE_RING_STYLES.some((choice) => choice.key === style) ? (style as (typeof WORKSPACE_RING_STYLES)[number]['key']) : 'orbit';
}

function arcPath(radius: number, startDeg: number, endDeg: number) {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [12 + radius * Math.cos(rad), 12 + radius * Math.sin(rad)] as const;
  };
  const [x1, y1] = point(startDeg);
  const [x2, y2] = point(endDeg);
  const large = ((endDeg - startDeg) % 360) > 180 ? 1 : 0;
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)}`;
}

function Beads({ lit }: { lit: boolean }) {
  const dots = Array.from({ length: 8 }, (_, i) => {
    const rad = ((i * 45 - 90) * Math.PI) / 180;
    return { x: 12 + 10.4 * Math.cos(rad), y: 12 + 10.4 * Math.sin(rad), head: i === 0 };
  });
  return (
    <svg viewBox="0 0 24 24" className="absolute inset-0 size-full" fill="none" aria-hidden="true">
      {dots.map((dot, i) =>
        lit && dot.head ? null : (
          <circle key={i} cx={dot.x.toFixed(3)} cy={dot.y.toFixed(3)} r="1.35" fill="currentColor" fillOpacity={lit ? 0.28 : 0.5} />
        ),
      )}
    </svg>
  );
}

export function WorkspaceStatusRing({ kind, style, label }: { kind: WorkspaceStatusKind; style?: string; label: string }) {
  const resolved = ringStyleKey(style);
  const working = kind === 'working';
  const color = working ? 'text-green-500' : kind === 'issue' ? 'text-amber-500' : 'text-blue-500';
  return (
    <span aria-label={label} className={`pointer-events-none absolute inset-0 ${color}`}>
      {resolved === 'orbit' ? (
        <>
          <svg viewBox="0 0 24 24" className="absolute inset-0 size-full" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10.4" stroke="currentColor" strokeOpacity={working ? 0.22 : 0.55} strokeWidth="1.9" />
          </svg>
          {working ? (
            <svg viewBox="0 0 24 24" className="absolute inset-0 size-full motion-safe:animate-spin [animation-duration:900ms]" fill="none" aria-hidden="true">
              <path d={arcPath(10.4, 0, 95)} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          ) : null}
        </>
      ) : resolved === 'pulse' ? (
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full border-[1.5px] border-current ${working ? 'ws-breathe' : 'opacity-80'}`}
        />
      ) : resolved === 'ellipsis' ? (
        <span aria-hidden="true" className="absolute inset-x-0 -bottom-[1px] flex justify-center gap-[3px]">
          {[0, 0.15, 0.3].map((delay) => (
            <span
              key={delay}
              className={`size-[3.5px] rounded-full bg-current ${working ? 'ws-dot' : 'opacity-80'}`}
              style={working ? { animationDelay: `${delay}s` } : undefined}
            />
          ))}
        </span>
      ) : resolved === 'beads' ? (
        <>
          <Beads lit={working} />
          {working ? (
            <svg viewBox="0 0 24 24" className="absolute inset-0 size-full motion-safe:animate-spin [animation-duration:1600ms]" fill="none" aria-hidden="true">
              <circle cx="12" cy="1.6" r="1.35" fill="currentColor" />
            </svg>
          ) : null}
        </>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className={`absolute inset-0 size-full ${working ? 'motion-safe:animate-spin [animation-duration:1400ms]' : ''}`}
          fill="none"
          aria-hidden="true"
        >
          <path d={arcPath(10.6, 140, 400)} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

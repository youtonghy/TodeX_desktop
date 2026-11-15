import { cx } from '@/utils/cx';
import { WORKSPACE_STATUS_TEXT, ringStyleKey, type WorkspaceStatusKind } from './workspaceIcons';

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
  return (
    <span aria-label={label} className={cx('pointer-events-none absolute inset-0', WORKSPACE_STATUS_TEXT[kind])}>
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
          className={cx('absolute inset-0 rounded-full border-[1.5px] border-current', working ? 'ws-breathe' : 'opacity-80')}
        />
      ) : resolved === 'ellipsis' ? (
        <span aria-hidden="true" className="absolute inset-x-0 -bottom-[1px] flex justify-center gap-[3px]">
          {[0, 0.15, 0.3].map((delay) => (
            <span
              key={delay}
              className={cx('size-[3.5px] rounded-full bg-current', working ? 'ws-dot' : 'opacity-80')}
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
          className={cx('absolute inset-0 size-full', working && 'motion-safe:animate-spin [animation-duration:1400ms]')}
          fill="none"
          aria-hidden="true"
        >
          <path d={arcPath(10.6, 140, 400)} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

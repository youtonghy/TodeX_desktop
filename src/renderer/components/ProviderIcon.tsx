import claudeCodeSvg from '@lobehub/icons-static-svg/icons/claudecode.svg?raw';
import codexSvg from '@lobehub/icons-static-svg/icons/codex.svg?raw';
import piSvg from '@lobehub/icons-static-svg/icons/pi.svg?raw';
import { RiRobot2Line } from '@remixicon/react';

type Props = {
  provider?: string | null;
  className?: string;
};

function InlineSvg({ svg, className }: { svg: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={['inline-flex shrink-0 [&>svg]:block [&>svg]:size-full', className].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function brandSvg(provider?: string | null): string | null {
  const id = provider?.trim().toLowerCase() ?? '';
  if (id === 'claude-code' || id.includes('claude')) return claudeCodeSvg;
  if (id === 'codex' || id.includes('codex')) return codexSvg;
  if (id === 'pi') return piSvg;
  return null;
}

export function ProviderIcon({ provider, className }: Props) {
  const svg = brandSvg(provider);
  if (svg) {
    return <InlineSvg className={className} svg={svg} />;
  }
  return <RiRobot2Line className={className} />;
}

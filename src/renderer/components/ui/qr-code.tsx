import { useMemo } from 'react';
import { encodeQrCode } from '@todex/protocol/qrCode';
import { cx } from '@/utils/cx';

/** A QR code drawn locally (recovery keys, pairing links, group invites);
 * the text never goes to a QR service. */
export function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const qr = useMemo(() => encodeQrCode(text), [text]);
  const quiet = 4;
  const size = qr.size + quiet * 2;
  const path = qr.modules.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + quiet} ${y + quiet}h1v1h-1z`] : [])).join('');
  // A scannable code stays black on white in both themes.
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className={cx('h-44 w-44 rounded-md bg-white', className)} shapeRendering="crispEdges">
      <path d={path} fill="#000" />
    </svg>
  );
}

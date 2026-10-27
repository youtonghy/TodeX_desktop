import { createServer } from 'node:net';

/** Settings → TodeX Container → host port range (defaults keep clear of the native backend's 7345). */
export const DEFAULT_PORT_START = 17345;
export const DEFAULT_PORT_COUNT = 100;
const MAX_PORT_COUNT = 1000;

export type PortRange = { start: number; count: number };

/** The configured range, or the default when the stored values are unusable. */
export function portRange(prefs: { portStart?: unknown; portCount?: unknown }): PortRange {
  const start = Number(prefs.portStart);
  const count = Number(prefs.portCount);
  const validStart = Number.isInteger(start) && start >= 1024 && start <= 65535 ? start : DEFAULT_PORT_START;
  const validCount = Number.isInteger(count) && count >= 1 && count <= MAX_PORT_COUNT ? count : DEFAULT_PORT_COUNT;
  return { start: validStart, count: Math.min(validCount, 65536 - validStart) };
}

function bindable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      // A host without IPv6 cannot have the port taken there.
      resolve(error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL');
    });
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/**
 * Whether nothing listens on `port`. The wildcard addresses are probed too:
 * macOS and Windows let a loopback bind succeed while another process holds
 * 0.0.0.0, and Docker Desktop would then take loopback traffic from it.
 */
export async function portAvailable(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '0.0.0.0', '::']) {
    if (!await bindable(port, host)) return false;
  }
  return true;
}

/** A random port of `range` that is neither reserved nor in use. */
export async function pickPort(
  range: PortRange,
  reserved: ReadonlySet<number>,
  available: (port: number) => Promise<boolean> = portAvailable,
  random: () => number = Math.random,
): Promise<number> {
  const candidates = Array.from({ length: range.count }, (_, index) => range.start + index).filter((port) => !reserved.has(port));
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
  }
  for (const port of candidates) if (await available(port)) return port;
  throw new Error(`no free port between ${range.start} and ${range.start + range.count - 1}; change the port range in Settings → TodeX Container`);
}

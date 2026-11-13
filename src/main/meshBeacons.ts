// LAN beacons of device group nodes (TodeX_backend docs/mesh-v1.md "LAN
// beacon"): nodes broadcast `{"t":"todex-mesh-beacon","v":1,"nodeId","port"}`
// to UDP 21047. The renderer asks for the recent ones and tries
// `http://<sender>:<port>` for nodes of its groups; the pinned transport key
// still authenticates whoever answers. The socket opens on the first request.
import dgram from 'node:dgram';

export const MESH_BEACON_PORT = 21047;
/** Beacons older than this are dropped (nodes send every 30 s). */
const BEACON_TTL_MS = 120_000;
const MAX_BEACONS = 256;

export type MeshBeacon = { nodeId: string; address: string; port: number; seenAt: number };

const NODE_ID = /^node_[A-Za-z0-9_-]{16}$/;

/** A beacon packet, or null for anything else. */
export function parseMeshBeacon(packet: Buffer, address: string, now = Date.now()): MeshBeacon | null {
  if (packet.length > 512) return null;
  let value: unknown;
  try {
    value = JSON.parse(packet.toString('utf8'));
  } catch {
    return null;
  }
  const beacon = value as { t?: unknown; v?: unknown; nodeId?: unknown; port?: unknown };
  if (beacon?.t !== 'todex-mesh-beacon' || beacon.v !== 1 || typeof beacon.nodeId !== 'string' || !NODE_ID.test(beacon.nodeId)) return null;
  const port = Number(beacon.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { nodeId: beacon.nodeId, address, port, seenAt: now };
}

export class MeshBeaconListener {
  private socket: dgram.Socket | null = null;
  private readonly beacons = new Map<string, MeshBeacon>();

  /** Recent beacons; starts listening on the first call. */
  list(now = Date.now()): MeshBeacon[] {
    this.start();
    for (const [key, beacon] of this.beacons) {
      if (now - beacon.seenAt > BEACON_TTL_MS) this.beacons.delete(key);
    }
    return [...this.beacons.values()];
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private start(): void {
    if (this.socket) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('message', (packet, remote) => {
      const beacon = parseMeshBeacon(packet, remote.address);
      if (!beacon) return;
      if (this.beacons.size >= MAX_BEACONS && !this.beacons.has(`${beacon.nodeId}@${beacon.address}`)) return;
      this.beacons.set(`${beacon.nodeId}@${beacon.address}`, beacon);
    });
    // Another app holding the port (or no network) only means no beacons.
    socket.on('error', (error) => {
      console.warn('[mesh] beacon listener stopped', error.message);
      socket.close();
    });
    socket.bind(MESH_BEACON_PORT);
  }
}

import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { TUNNEL_CHUNK_BYTES, TUNNEL_WINDOW_BYTES } from '@todex/protocol/agentDesktop';
import type { ExecutorLogger } from './executorLink';

/** Sends a frame on a backend's executor connection; false when offline. */
export type TunnelSend = (type: string, payload: Record<string, unknown>) => boolean;

type Listener = { server: Server; localPort: number; remotePort: number; conversationId: string; profileId: string };

type Stream = {
  socket: Socket;
  profileId: string;
  /** Bytes we may still send to the daemon before its acks. */
  credit: number;
  opened: boolean;
  /** Read from the socket, waiting for credit. */
  pending: Buffer[];
};

/**
 * Forwards a remote daemon's loopback ports to this desktop: a local
 * listener per conversation and port, each accepted connection a
 * `tunnel.*` stream on the executor connection. The local port matches the
 * remote one when it is free, so the page keeps its origin.
 */
export class TunnelManager {
  private readonly listeners = new Map<string, Listener>();
  private readonly streams = new Map<string, Stream>();

  constructor(private readonly send: (profileId: string) => TunnelSend, private readonly log: ExecutorLogger) {}

  /** The local port forwarding `remotePort` for the conversation. */
  async forward(profileId: string, conversationId: string, remotePort: number): Promise<number> {
    const key = `${profileId}:${conversationId}:${remotePort}`;
    const existing = this.listeners.get(key);
    if (existing) return existing.localPort;
    const server = createServer(socket => this.accept(profileId, conversationId, remotePort, socket));
    const localPort = await new Promise<number>((resolve, reject) => {
      const listen = (port: number) => {
        server.once('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE' && port !== 0) listen(0);
          else reject(error);
        });
        server.listen(port, '127.0.0.1', () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      };
      listen(remotePort);
    });
    this.listeners.set(key, { server, localPort, remotePort, conversationId, profileId });
    this.log('info', 'agentDesktop.tunnel.listening', { profileId, conversationId, remotePort, localPort });
    return localPort;
  }

  /** Access revoked: stop forwarding the conversation's ports. */
  releaseConversation(profileId: string, conversationId: string): void {
    for (const [key, listener] of this.listeners) {
      if (listener.profileId === profileId && listener.conversationId === conversationId) {
        listener.server.close();
        this.listeners.delete(key);
      }
    }
  }

  /** The executor connection dropped: its streams are gone; listeners stay for the reconnect. */
  disconnected(profileId: string): void {
    for (const [id, stream] of this.streams) {
      if (stream.profileId === profileId) {
        this.streams.delete(id);
        stream.socket.destroy();
      }
    }
  }

  closeAll(): void {
    for (const listener of this.listeners.values()) listener.server.close();
    this.listeners.clear();
    for (const stream of this.streams.values()) stream.socket.destroy();
    this.streams.clear();
  }

  /** `tunnel.opened|data|ack|close` from the daemon. */
  frame(type: string, payload: Record<string, unknown>): void {
    const streamId = String(payload.streamId ?? '');
    const stream = this.streams.get(streamId);
    if (!stream) return;
    switch (type) {
      case 'tunnel.opened':
        stream.opened = true;
        this.pump(streamId, stream);
        return;
      case 'tunnel.data': {
        const bytes = Buffer.from(String(payload.data ?? ''), 'base64');
        stream.socket.write(bytes, () => {
          this.send(stream.profileId)('tunnel.ack', { streamId, bytes: bytes.length });
        });
        return;
      }
      case 'tunnel.ack':
        stream.credit = Math.min(TUNNEL_WINDOW_BYTES, stream.credit + Number(payload.bytes ?? 0));
        this.pump(streamId, stream);
        return;
      case 'tunnel.close':
        this.streams.delete(streamId);
        if (payload.error) this.log('debug', 'agentDesktop.tunnel.closed', { streamId, error: payload.error });
        stream.socket.end();
        return;
      default:
    }
  }

  /** Sends buffered bytes within the credit; pauses the socket while any wait. */
  private pump(streamId: string, stream: Stream): void {
    const send = this.send(stream.profileId);
    while (stream.pending.length && stream.credit > 0) {
      const head = stream.pending[0];
      const size = Math.min(head.length, TUNNEL_CHUNK_BYTES, stream.credit);
      const part = head.subarray(0, size);
      if (size === head.length) stream.pending.shift();
      else stream.pending[0] = head.subarray(size);
      stream.credit -= size;
      if (!send('tunnel.data', { streamId, data: part.toString('base64') })) {
        stream.socket.destroy();
        return;
      }
    }
    if (stream.pending.length) stream.socket.pause();
    else if (stream.opened) stream.socket.resume();
  }

  private accept(profileId: string, conversationId: string, remotePort: number, socket: Socket): void {
    const send = this.send(profileId);
    const streamId = randomUUID();
    const stream: Stream = { socket, profileId, credit: TUNNEL_WINDOW_BYTES, opened: false, pending: [] };
    socket.pause();
    this.streams.set(streamId, stream);
    if (!send('tunnel.open', { streamId, conversationId, port: remotePort })) {
      this.streams.delete(streamId);
      socket.destroy();
      return;
    }
    socket.on('data', (chunk: Buffer) => {
      stream.pending.push(chunk);
      this.pump(streamId, stream);
    });
    const finish = () => {
      if (this.streams.delete(streamId)) send('tunnel.close', { streamId });
    };
    socket.on('end', finish);
    socket.on('close', finish);
    socket.on('error', finish);
  }
}

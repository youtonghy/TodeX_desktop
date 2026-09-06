export type ProtocolCommand = { id: string; type: string; payload: Record<string, unknown> };

export class ProtocolCommandError extends Error {
  constructor(
    message: string,
    readonly state: 'not-sent' | 'rejected' | 'unknown',
    readonly requestId: string,
  ) {
    super(message);
    this.name = 'ProtocolCommandError';
  }
}

type PendingCommand = {
  message: ProtocolCommand;
  sent: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

/** A command is queued only until its first send. Losing an ACK must never
 * resend a command that may already have started a turn or changed files. */
export class ProtocolCommands {
  private readonly pending = new Map<string, PendingCommand>();

  constructor(private readonly send: (message: ProtocolCommand) => boolean) {}

  request(message: ProtocolCommand, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    if (this.pending.has(message.id) || this.pending.size >= 64) {
      return Promise.reject(new ProtocolCommandError('待处理请求过多，请等待现有请求完成。', 'not-sent', message.id));
    }
    return new Promise((resolve, reject) => {
      const entry: PendingCommand = {
        message, sent: false, resolve, reject,
        timer: setTimeout(() => {
          if (!this.pending.delete(message.id)) return;
          reject(new ProtocolCommandError(
            entry.sent ? '后端尚未确认，执行状态待确认。正在核对记录，请勿重复发送。' : '消息未发送：连接后端超时。',
            entry.sent ? 'unknown' : 'not-sent', message.id,
          ));
        }, timeoutMs),
      };
      this.pending.set(message.id, entry);
      this.sendUnsent(entry);
    });
  }

  resolve(id: string, result: Record<string, unknown>): boolean {
    const entry = this.take(id);
    if (!entry) return false;
    entry.resolve(result);
    return true;
  }

  reject(id: string, message: string): boolean {
    const entry = this.take(id);
    if (!entry) return false;
    entry.reject(new ProtocolCommandError(message, 'rejected', id));
    return true;
  }

  flush(): void {
    for (const entry of this.pending.values()) if (!entry.sent) this.sendUnsent(entry);
  }

  disconnect(): void {
    for (const [id, entry] of this.pending) {
      if (!entry.sent) continue;
      this.take(id);
      entry.reject(new ProtocolCommandError('连接在确认前中断，执行状态待确认。请勿重复发送。', 'unknown', id));
    }
  }

  dispose(): void {
    for (const [id, entry] of this.pending) {
      this.take(id);
      entry.reject(new ProtocolCommandError('连接已关闭。', entry.sent ? 'unknown' : 'not-sent', id));
    }
  }

  private take(id: string): PendingCommand | undefined {
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
    }
    return entry;
  }

  private sendUnsent(entry: PendingCommand): void {
    try {
      entry.sent = this.send(entry.message);
    } catch (error) {
      this.take(entry.message.id);
      entry.reject(new ProtocolCommandError(error instanceof Error ? error.message : '消息未能发送。', 'not-sent', entry.message.id));
    }
  }
}

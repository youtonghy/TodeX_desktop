/* eslint-disable no-control-regex -- These expressions deliberately remove terminal control sequences. */
/** Terminal decoration is presentation only; keep the original event and editor text intact. */
export function piExtensionPlainText(value: string): string {
  return value
    // OSC (including hyperlinks and title changes) and other terminal string commands.
    .replace(/(?:\u001b\]|\u009d)[\s\S]*?(?:\u0007|\u001b\\|\u009c|$)/g, '')
    .replace(/(?:\u001b[P^_]|[\u0090\u009e\u009f])[\s\S]*?(?:\u001b\\|\u009c|$)/g, '')
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

const runtimeStopReasons: Record<string, string> = {
  user_closed: '你已停止 Pi 后台运行。',
  maintenance_compact: '上下文压缩需要重启 Pi 插件；下次发送消息时会重新启动。',
  maintenance_clone: '会话复制需要重启 Pi 插件；下次发送消息时会重新启动。',
  daemon_shutdown: '后端已关闭，Pi 插件运行已结束。',
  daemon_restarted: '后端已重新启动，之前的 Pi 插件运行已结束。',
  workspace_access_revoked: '工作区执行权限已撤销，Pi 插件运行已结束。',
  conversation_deleted: '会话已删除，Pi 插件运行已结束。',
  conversation_expired: '会话已过期，Pi 插件运行已结束。',
  expired: 'Pi 插件会话已过期。',
  session_closed: 'Pi 会话已关闭。',
  native_session_closed: 'Pi 进程已退出。',
  protocol_error: 'Pi 连接异常，后台运行已停止。',
};

export function piRuntimeStopReason(reason: string): string {
  return Object.hasOwn(runtimeStopReasons, reason) ? runtimeStopReasons[reason] : piExtensionPlainText(reason);
}

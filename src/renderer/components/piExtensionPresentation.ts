/* eslint-disable no-control-regex -- These expressions deliberately remove terminal control sequences. */
import { t, type MessageKey } from '../i18n';

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

const runtimeStopReasonKeys: Record<string, MessageKey> = {
  user_closed: 'pi.reasonUserClosed',
  maintenance_compact: 'pi.reasonMaintenanceCompact',
  maintenance_clone: 'pi.reasonMaintenanceClone',
  daemon_shutdown: 'pi.reasonDaemonShutdown',
  daemon_restarted: 'pi.reasonDaemonRestarted',
  workspace_access_revoked: 'pi.reasonWorkspaceAccessRevoked',
  conversation_deleted: 'pi.reasonConversationDeleted',
  conversation_expired: 'pi.reasonConversationExpired',
  expired: 'pi.reasonExpired',
  session_closed: 'pi.reasonSessionClosed',
  native_session_closed: 'pi.reasonNativeSessionClosed',
  protocol_error: 'pi.reasonProtocolError',
};

export function piRuntimeStopReason(reason: string): string {
  const key = runtimeStopReasonKeys[reason];
  return key ? t(key) : piExtensionPlainText(reason);
}

import type { AgentCallStatus } from '@todex/protocol/agentCalling';
import type { ChipProps } from '@/components/base/badges/chip';
import type { MessageKey } from '../i18n';

export const AGENT_CALL_STATUS_LABELS: Record<AgentCallStatus, MessageKey> = {
  running: 'agentCalls.statusRunning',
  waiting_permission: 'agentCalls.statusWaitingPermission',
  completed: 'agentCalls.statusCompleted',
  failed: 'agentCalls.statusFailed',
  cancelled: 'agentCalls.statusCancelled',
  interrupted: 'agentCalls.statusInterrupted',
};

export const AGENT_CALL_STATUS_COLORS: Record<AgentCallStatus, NonNullable<ChipProps['color']>> = {
  running: 'blue',
  waiting_permission: 'yellow',
  completed: 'lime',
  failed: 'rose',
  cancelled: 'neutral',
  interrupted: 'yellow',
};

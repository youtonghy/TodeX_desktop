import { Button } from '@heroui/react';
import { useNoticeToast } from './NoticeToast';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';

type Props = {
  runtime?: ConversationRuntime;
  reportedError?: string;
  running: boolean;
  canConfigure: boolean;
  canSteer: boolean;
  canUseNativeQueue: boolean;
  piQueue: boolean;
  controlStatus?: 'pending' | 'unknown';
  nextModel: string;
  nextEffort?: string | null;
  canSendText: boolean;
  localQueue: readonly { id: string; text: string }[];
  localPaused: boolean;
  onApply: () => void;
  onSteer: () => void;
  onRecover: () => void;
  onRemoveNative: (id: string) => void;
  onClearNative: () => void;
  onRemoveLocal: (id: string) => void;
  onResumeLocal: () => void;
};

export function ConversationControls({ runtime, reportedError, running, canConfigure, canSteer, canUseNativeQueue,
  piQueue, controlStatus, nextModel, nextEffort, canSendText, localQueue, localPaused,
  onApply, onSteer, onRecover, onRemoveNative, onClearNative, onRemoveLocal, onResumeLocal }: Props) {
  const effective = runtime?.effectiveConfig;
  const nativeItems = runtime?.queueItems.filter(item => ['queued', 'pending', 'delivering', 'unknown'].includes(item.status)) ?? [];
  const disabled = Boolean(controlStatus);
  const confirmed = effective?.source === 'provider-confirmed';
  const model = confirmed && typeof effective.model === 'string' ? effective.model : '';
  const effort = confirmed ? effective?.reasoningEffort ?? effective?.effort ?? effective?.thinkingLevel : undefined;
  const selectionChanged = Boolean(model && nextModel && (model !== nextModel
    || (nextEffort && nextEffort !== effort)));
  const showApply = running && canConfigure && Boolean(nextModel) && (!model || selectionChanged);
  const showSteer = running && canSteer && canSendText;
  const applying = running && runtime?.configurationStatus === 'pending';
  const scope = runtime?.conversationId;
  useNoticeToast(controlStatus === 'unknown' ? '控制请求待确认'
    : runtime?.configurationError && runtime.configurationError !== reportedError ? '配置未应用' : null, {
    description: controlStatus === 'unknown' ? '请求可能已送达。核对记录后再继续，避免重复纠偏或排队。' : runtime?.configurationError,
    scope,
    timeout: controlStatus === 'unknown' ? 0 : undefined,
    actionLabel: controlStatus === 'unknown' ? '核对记录' : undefined,
    onAction: onRecover,
  });
  useNoticeToast(applying ? '正在应用配置…' : showApply
    ? selectionChanged ? `下轮：${nextModel}${nextEffort ? ` · ${nextEffort}` : ''}` : '可将所选配置应用到本轮'
    : null, {
    variant: 'info',
    description: applying ? '等待 Agent 确认配置。' : '配置对后续步骤生效。',
    scope,
    timeout: 0,
    actionLabel: showApply && !applying ? '应用到本轮' : undefined,
    actionPending: controlStatus === 'pending',
    actionDisabled: disabled,
    onAction: onApply,
  });
  useNoticeToast(showSteer ? '可发送纠偏' : null, {
    variant: 'info',
    description: '纠偏使用输入框中的文字。',
    scope,
    timeout: 0,
    actionLabel: '发送纠偏',
    actionDisabled: disabled,
    onAction: onSteer,
  });
  if (!nativeItems.length && !localQueue.length) return null;
  return <div className="mb-2 space-y-2">
    {nativeItems.length > 0 ? <div className="border-border rounded-lg border p-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span>Agent 队列 · {nativeItems.length}{runtime?.queuePaused ? ' · 已暂停，请核对' : ''}</span>
        {piQueue && running && canUseNativeQueue ? <Button size="sm" variant="ghost" isDisabled={disabled}
          onPress={onClearNative}>清空待处理输入（含纠偏）</Button> : null}
      </div>
      {nativeItems.map(item => <div key={item.id} className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">{item.text || '待处理消息'}</span>
        {!piQueue && running && canUseNativeQueue ? <Button size="sm" variant="ghost" isDisabled={disabled}
          aria-label={`移除排队消息 ${item.text}`} onPress={() => onRemoveNative(item.id)}>移除</Button> : null}
      </div>)}
    </div> : null}
    {localQueue.length > 0 ? <div className="border-border rounded-lg border p-2 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span>候选消息 · {localQueue.length}{localPaused ? ' · 已暂停' : ' · 本轮完成后发送'}</span>
        {!running ? <Button size="sm" variant="secondary" isDisabled={disabled} onPress={onResumeLocal}>继续发送</Button> : null}
      </div>
      {localQueue.map(item => <div key={item.id} className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">{item.text || '附件消息'}</span>
        <Button size="sm" variant="ghost" aria-label={`移除候选消息 ${item.text}`} onPress={() => onRemoveLocal(item.id)}>移除</Button>
      </div>)}
    </div> : null}
  </div>;
}

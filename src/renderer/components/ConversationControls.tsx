import { Alert, Button } from '@heroui/react';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';

type Props = {
  runtime?: ConversationRuntime;
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

export function ConversationControls({ runtime, running, canConfigure, canSteer, canUseNativeQueue,
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
  const showConfiguration = running && (selectionChanged || runtime?.configurationStatus === 'pending' || showApply || showSteer);
  if (!showConfiguration && !runtime?.configurationError && controlStatus !== 'unknown'
    && !nativeItems.length && !localQueue.length) return null;
  return <div className="mb-2 space-y-2">
    {showConfiguration ? <div className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {selectionChanged ? <span>下轮：{nextModel}{nextEffort ? ` · ${nextEffort}` : ''}</span> : null}
      {runtime?.configurationStatus === 'pending' ? <span>正在应用配置…</span> : null}
      {showApply ? <Button size="sm" variant="ghost" isDisabled={disabled}
        isPending={controlStatus === 'pending'} onPress={onApply}>应用到本轮</Button> : null}
      {showSteer ? <Button size="sm" variant="secondary" isDisabled={disabled}
        onPress={onSteer}>发送纠偏</Button> : null}
    </div> : null}
    {showApply || showSteer ? <p className="text-muted text-xs">
      {showSteer ? '纠偏使用输入框中的文字。' : ''}{showApply ? '配置对后续步骤生效。' : ''}
    </p> : null}
    {runtime?.configurationError || controlStatus === 'unknown' ? <Alert status="warning">
      <Alert.Indicator /><Alert.Content>
        <Alert.Title>{controlStatus === 'unknown' ? '控制请求待确认' : '配置未应用'}</Alert.Title>
        <Alert.Description>{controlStatus === 'unknown' ? '请求可能已送达。核对记录后再继续，避免重复纠偏或排队。' : runtime?.configurationError}</Alert.Description>
        {controlStatus === 'unknown' ? <Button size="sm" variant="secondary" onPress={onRecover}>核对记录</Button> : null}
      </Alert.Content>
    </Alert> : null}
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

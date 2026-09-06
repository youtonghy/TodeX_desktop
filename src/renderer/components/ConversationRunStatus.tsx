import React, { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Button } from '@heroui/react';
import { PromptInput } from '@heroui-pro/react/prompt-input';
import { usageTotalTokens, type ConversationRuntime } from '@todex/protocol/conversationRuntime';
import type { ContextCompactionState } from '@todex/protocol/v2';
import { permissionActions, type PendingRequest, type PermissionOption } from '@todex/protocol/todex';
import type { UsageRecord } from '@todex/protocol/mobileParity';

type SubmissionStatus = 'sending' | 'running' | 'unknown' | undefined;
type Props = {
  submissionStatus?: SubmissionStatus;
  runtime?: Pick<ConversationRuntime, 'status' | 'lastProgressAt'>;
  compaction?: ContextCompactionState & { recommended?: boolean };
  effectivePermission: string;
  permissionEnforcement?: string;
  canCompact: boolean;
  thinking: boolean;
  onRecover: () => Promise<void>;
  onCompact: () => void;
};

export function ConversationRunStatus({ submissionStatus, runtime, compaction, effectivePermission,
  permissionEnforcement, canCompact, thinking, onRecover, onCompact }: Props) {
  const [now, setNow] = useState(Date.now);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const unknown = submissionStatus === 'unknown';
  const running = runtime?.status === 'running';
  useEffect(() => {
    if (!running || unknown) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [running, unknown]);
  const lastProgressAt = Date.parse(runtime?.lastProgressAt ?? '');
  const stalled = running && !unknown && Number.isFinite(lastProgressAt) && now - lastProgressAt >= 120_000;
  const compactionLabel = compaction?.status === 'running' ? '正在压缩上下文'
    : compaction?.status === 'failed' ? `上下文压缩失败${compaction.error ? `：${compaction.error}` : ''}`
      : compaction?.status === 'completed' ? '上下文压缩完成'
        : compaction?.recommended ? '建议压缩上下文' : '';
  const recover = async () => {
    setRecovering(true);
    setRecoveryError('');
    try { await onRecover(); }
    catch (error) { setRecoveryError(error instanceof Error ? error.message : '核对失败，请重试'); }
    finally { setRecovering(false); }
  };
  return <>
    {unknown ? <Alert status="warning" className="mb-2">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>执行状态待确认</Alert.Title>
        <Alert.Description>尚未确认这次提交的执行结果。核对记录后再发送，避免重复执行。</Alert.Description>
        <Button className="mt-2" size="sm" variant="secondary" isPending={recovering} onPress={() => { void recover(); }}>核对记录</Button>
        {recoveryError ? <p className="text-danger mt-1 text-xs" role="alert">{recoveryError}</p> : null}
      </Alert.Content>
    </Alert> : null}
    {stalled ? <Alert status="warning" className="mb-2">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>暂未收到进展</Alert.Title>
        <Alert.Description>已超过两分钟没有收到新进展。任务可能仍在运行，你可以继续等待，或使用停止按钮取消。</Alert.Description>
      </Alert.Content>
    </Alert> : null}
    {runtime ? <div className="text-muted mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" role="status">
      <span>生效权限：{effectivePermission || '等待 Agent 确认'}</span>
      {permissionEnforcement ? <span>{permissionEnforcement}</span> : null}
      {compactionLabel ? <span className={compaction?.status === 'failed' ? 'text-danger' : undefined}>{compactionLabel}</span> : null}
      {canCompact ? <Button size="sm" variant="ghost" isDisabled={thinking || unknown || compaction?.status === 'running'} onPress={onCompact}>压缩上下文</Button> : null}
    </div> : null}
  </>;
}

/** Keep the submission guard at the actual composer boundary, including Enter. */
export function ConversationPromptInput({ submissionStatus, onSubmit, isDisabled, status, ...props }:
  ComponentProps<typeof PromptInput> & { submissionStatus?: SubmissionStatus }) {
  const blocked = submissionStatus === 'unknown' || submissionStatus === 'sending';
  return <PromptInput {...props} status={submissionStatus === 'sending' ? 'submitted' : status}
    isDisabled={isDisabled || submissionStatus === 'unknown'}
    onSubmit={() => { if (!blocked) onSubmit?.(); }} />;
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}
export function TurnUsageSummary({ records }: { records: readonly UsageRecord[] }) {
  const totals = records.reduce((sum, record) => ({
    input: sum.input + record.inputTokens, output: sum.output + record.outputTokens,
    cacheRead: sum.cacheRead + record.cachedInputTokens, cacheWrite: sum.cacheWrite + record.cacheWriteTokens,
    total: sum.total + usageTotalTokens(record),
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  return <div className="min-w-52 space-y-1 p-1 text-xs">
    <p className="font-medium">本轮统计</p>
    {records.length ? <>
      <p className="text-muted">模型：{[...new Set(records.map(record => record.model))].join('、')}</p>
      <p>输入 {formatTokenCount(totals.input)} · 输出 {formatTokenCount(totals.output)}</p>
      <p>缓存读取 {formatTokenCount(totals.cacheRead)} · 写入 {formatTokenCount(totals.cacheWrite)}</p>
      <p>总计 {formatTokenCount(totals.total)} tokens</p>
    </> : <p className="text-muted">暂无可归属本轮的用量数据。</p>}
  </div>;
}


export function ConversationPermissionActions({ request, onSelect }:
  { request: PendingRequest; onSelect: (option: boolean | PermissionOption) => void }) {
  return <>{permissionActions(request).map(option => <Button
    key={typeof option === 'boolean' ? String(option) : option.optionId}
    size="sm"
    variant={typeof option === 'boolean' ? (option ? 'primary' : 'danger-soft')
      : option.kind.startsWith('reject') || option.kind === 'abort_turn' ? 'danger-soft' : 'primary'}
    onPress={() => onSelect(option)}
  >{typeof option === 'boolean' ? (option ? '同意' : '拒绝')
    : option.kind === 'abort_turn' ? '拒绝并停止本轮' : option.name}</Button>)}</>;
}

import React, { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Button, Description, Form, Input, Label, Link, TextArea, TextField } from '@heroui/react';
import { NativeSelect } from '@heroui-pro/react/native-select';
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
  permissionsManagedByAgent?: boolean;
  thinking: boolean;
  onRecover: () => Promise<void>;
};

export function ConversationRunStatus({ submissionStatus, runtime, compaction, effectivePermission,
  permissionEnforcement, permissionsManagedByAgent = false, thinking, onRecover }: Props) {
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
    {runtime && (thinking || compactionLabel) ? <div className="text-muted mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" role="status">
      {permissionsManagedByAgent ? (thinking ? <span>权限由 Agent 管理</span> : null) : thinking ? <>
        <span>{effectivePermission ? `本轮权限：${effectivePermission}` : '本轮权限尚未回读'}</span>
        {permissionEnforcement ? <span>{permissionEnforcement}</span> : null}
      </> : null}
      {compactionLabel ? <span className={compaction?.status === 'failed' ? 'text-danger' : undefined}>{compactionLabel}</span> : null}
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


type PermissionAnswerData = Record<string, unknown>;
type PermissionField = {
  id: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'integer' | 'boolean';
  required: boolean;
  multiline?: boolean;
  secret?: boolean;
  choices?: { label: string; value: string | number | boolean }[];
  initial?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};
type PermissionForm = {
  fields: PermissionField[];
  mode: 'elicitation' | 'user_input' | 'extension_ui' | 'url';
  method?: string;
  url?: string;
  unsupported?: boolean;
};
const permissionObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const permissionString = (value: unknown): string => typeof value === 'string' ? value : '';

function permissionForm(request: PendingRequest): PermissionForm | null {
  const details = permissionObject(request.data.details);
  const kind = permissionString(request.data.kind);
  if (kind === 'elicitation' && details.mode === 'url') {
    let url: string | undefined;
    try { const parsed = new URL(permissionString(details.url)); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href; } catch { /* invalid links are not opened */ }
    return { mode: 'url', fields: [], url, unsupported: !url };
  }
  if (kind === 'elicitation') {
    const schema = permissionObject(details.requestedSchema ?? details.schema);
    const properties = permissionObject(schema.properties);
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [];
    let unsupported = (!Object.keys(schema).length) || (schema.type !== undefined && schema.type !== 'object')
      || required.some(key => !Object.hasOwn(properties, key));
    const fields = Object.entries(properties).flatMap(([id, raw]): PermissionField[] => {
      const property = permissionObject(raw);
      const enumValues = Array.isArray(property.enum) ? property.enum : property.const !== undefined ? [property.const] : undefined;
      const type = property.type ?? (enumValues?.length ? typeof enumValues[0] : 'string');
      if (!['string', 'number', 'integer', 'boolean'].includes(String(type))
        || enumValues?.some(value => !['string', 'number', 'boolean'].includes(typeof value))) {
        unsupported = true;
        return [];
      }
      const choices = enumValues?.map(value => ({ label: String(value), value: value as string | number | boolean }));
      const field: PermissionField = {
        id, label: permissionString(property.title) || id, description: permissionString(property.description),
        type: type as PermissionField['type'], required: required.includes(id), choices,
        minimum: typeof property.minimum === 'number' ? property.minimum : undefined,
        maximum: typeof property.maximum === 'number' ? property.maximum : undefined,
        minLength: typeof property.minLength === 'number' ? property.minLength : undefined,
        maxLength: typeof property.maxLength === 'number' ? property.maxLength : undefined,
      };
      if (property.default !== undefined) {
        const index = choices?.findIndex(choice => choice.value === property.default);
        field.initial = choices ? index !== undefined && index >= 0 ? String(index) : '' : String(property.default);
      }
      return [field];
    });
    return { mode: 'elicitation', fields, unsupported };
  }
  if (kind === 'user_input') {
    const questions = Array.isArray(details.questions) ? details.questions : [];
    let unsupported = !questions.length;
    const fields = questions.flatMap((raw): PermissionField[] => {
      const question = permissionObject(raw);
      const id = permissionString(question.id);
      if (!id) { unsupported = true; return []; }
      // A text response also supports the agent's free-form "Other" path.
      const choices = Array.isArray(question.options) ? question.options.map(option => {
        const item = permissionObject(option); const label = permissionString(item.label) || permissionString(option);
        return { label, value: label };
      }).filter(option => option.label) : [];
      return [{ id, label: permissionString(question.question) || permissionString(question.header) || id,
        description: choices.length ? `参考选项：${choices.map(choice => choice.label).join('；')}` : undefined,
        type: 'string', required: true, secret: question.isSecret === true,
        choices: question.isOther === true ? undefined : choices.length ? choices : undefined }];
    });
    return { mode: 'user_input', fields, unsupported };
  }
  if (kind === 'extension_ui') {
    const method = permissionString(details.method);
    if (!['confirm', 'select', 'input', 'editor'].includes(method)) return { mode: 'extension_ui', method, fields: [], unsupported: true };
    const choices = method === 'select' && Array.isArray(details.options)
      ? details.options.filter((value): value is string => typeof value === 'string').map(value => ({ label: value, value })) : undefined;
    return { mode: 'extension_ui', method, unsupported: method === 'select' && !choices?.length,
      fields: [{ id: method === 'confirm' ? 'confirmed' : 'value', label: permissionString(details.message) || permissionString(details.title) || (method === 'confirm' ? '是否确认？' : '你的回答'),
        type: method === 'confirm' ? 'boolean' : 'string', required: true, choices,
        multiline: method === 'editor', initial: method === 'editor' ? permissionString(details.prefill) : undefined }] };
  }
  return null;
}

function permissionFormAnswer(form: PermissionForm, values: Record<string, string>): { data?: PermissionAnswerData; error?: string } {
  if (form.unsupported) return { error: '这项请求包含暂不支持的输入格式，请取消或让 Agent 改用简单字段。' };
  if (form.mode === 'url') return { data: { completed: true } };
  const data: PermissionAnswerData = Object.create(null) as PermissionAnswerData;
  for (const field of form.fields) {
    const text = values[field.id] ?? field.initial ?? '';
    if (!text.trim()) {
      if (field.required) return { error: `请填写「${field.label}」。` };
      continue;
    }
    let value: string | number | boolean = text;
    if (field.choices) {
      const index = Number(text);
      if (!Number.isInteger(index) || !field.choices[index]) return { error: `请选择「${field.label}」。` };
      value = field.choices[index].value;
    } else if (field.type === 'boolean') {
      if (!['true', 'false'].includes(text)) return { error: `请选择「${field.label}」。` };
      value = text === 'true';
    } else if (field.type === 'number' || field.type === 'integer') {
      value = Number(text);
      if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) return { error: `「${field.label}」需要有效${field.type === 'integer' ? '整数' : '数字'}。` };
      if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) return { error: `「${field.label}」超出了允许范围。` };
    }
    if (typeof value === 'string' && ((field.minLength !== undefined && value.length < field.minLength) || (field.maxLength !== undefined && value.length > field.maxLength))) return { error: `「${field.label}」的长度不符合要求。` };
    data[field.id] = value;
  }
  if (form.mode === 'user_input') return { data: { answers: Object.fromEntries(Object.entries(data).map(([id, value]) => [id, { answers: [String(value)] }])) } };
  return { data };
}

function PermissionResponseForm({ request, form, onSelect }: { request: PendingRequest; form: PermissionForm;
  onSelect: (option: boolean | PermissionOption, data?: PermissionAnswerData) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const inputPrefix = React.useId();
  const options = permissionActions(request);
  const submit = options.find(option => typeof option !== 'boolean' && option.kind === 'answer');
  const update = (id: string, value: string) => { setValues(previous => ({ ...previous, [id]: value })); setError(''); };
  return <Form className="flex w-full min-w-0 flex-col gap-3 py-2" onSubmit={event => {
    event.preventDefault();
    if (!submit) return;
    const answer = permissionFormAnswer(form, values);
    if (answer.error) { setError(answer.error); return; }
    onSelect(submit, answer.data);
  }}>
    {form.mode === 'url' && form.url ? <div className="space-y-2 text-sm">
      <Link href={form.url} target="_blank" rel="noopener noreferrer">打开验证页面<Link.Icon /></Link>
      <p className="text-muted">在页面完成操作后，再点击“已完成，继续”。</p>
    </div> : null}
    {form.unsupported ? <p className="text-warning text-sm" role="status">这项请求包含暂不支持的输入格式，请取消或让 Agent 改用简单字段。</p> : null}
    {form.fields.map((field, index) => {
      const value = values[field.id] ?? field.initial ?? '';
      const inputId = `${inputPrefix}-${index}`;
      return field.choices || field.type === 'boolean' ? <div key={field.id} className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={inputId}>{field.label}{field.required ? ' *' : ''}</Label>
        <NativeSelect fullWidth>
          <NativeSelect.Trigger id={inputId} value={value} required={field.required} onChange={event => update(field.id, event.target.value)}>
            <NativeSelect.Option value="">请选择</NativeSelect.Option>
            {field.choices ? field.choices.map((choice, choiceIndex) => <NativeSelect.Option key={choiceIndex} value={String(choiceIndex)}>{choice.label}</NativeSelect.Option>)
              : <><NativeSelect.Option value="true">是</NativeSelect.Option><NativeSelect.Option value="false">否</NativeSelect.Option></>}
          </NativeSelect.Trigger>
        </NativeSelect>
        {field.description ? <Description>{field.description}</Description> : null}
      </div> : <TextField key={field.id} className="w-full" value={value} onChange={text => update(field.id, text)} isRequired={field.required}>
        <Label>{field.label}</Label>
        {field.multiline ? <TextArea rows={4} /> : <Input type={field.secret ? 'password' : 'text'} inputMode={field.type === 'number' || field.type === 'integer' ? 'decimal' : undefined} autoComplete="off" />}
        {field.description ? <Description>{field.description}</Description> : null}
      </TextField>;
    })}
    {error ? <p className="text-danger text-sm" role="alert">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      {submit ? <Button size="sm" type="submit" isDisabled={form.unsupported}>{form.mode === 'url' ? '已完成，继续' : '提交回答'}</Button> : null}
      {options.filter(option => typeof option === 'boolean' ? !option : option.kind.startsWith('reject') || option.kind === 'abort_turn').map(option => <Button
        key={typeof option === 'boolean' ? String(option) : option.optionId} type="button" size="sm" variant="danger-soft" onPress={() => onSelect(option)}
      >{typeof option === 'boolean' ? '拒绝' : option.kind === 'abort_turn' ? '拒绝并停止本轮' : option.name}</Button>)}
    </div>
  </Form>;
}

export function ConversationPermissionActions({ request, onSelect }:
  { request: PendingRequest; onSelect: (option: boolean | PermissionOption, data?: PermissionAnswerData) => void }) {
  const form = permissionForm(request);
  if (form) return <PermissionResponseForm key={request.requestId} request={request} form={form} onSelect={onSelect} />;
  return <>{permissionActions(request).map(option => <Button
    key={typeof option === 'boolean' ? String(option) : option.optionId}
    size="sm"
    variant={typeof option === 'boolean' ? (option ? 'primary' : 'danger-soft')
      : option.kind.startsWith('reject') || option.kind === 'abort_turn' ? 'danger-soft' : 'primary'}
    onPress={() => onSelect(option)}
  >{typeof option === 'boolean' ? (option ? '同意' : '拒绝')
    : option.kind === 'abort_turn' ? '拒绝并停止本轮' : option.name}</Button>)}</>;
}

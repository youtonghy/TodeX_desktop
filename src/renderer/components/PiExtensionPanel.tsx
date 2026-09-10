import { Accordion, Button, ScrollShadow } from '@heroui/react';
import { Widget } from '@heroui-pro/react/widget';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { piExtensionPlainText, piRuntimeStopReason } from './piExtensionPresentation';

type ExtensionUi = ConversationRuntime['extensionUi'];
type EditorRequest = NonNullable<ExtensionUi['editorRequest']>;

export type PiExtensionPanelProps = {
  extensionUi: ExtensionUi;
  placement: 'aboveEditor' | 'belowEditor';
  providerRuntime?: ConversationRuntime['providerRuntime'];
  /** Only pass a live editor request that the user has not already handled. */
  pendingEditorRequest?: EditorRequest;
  onReplaceEditor?: (request: EditorRequest) => void;
  onDismissEditor?: (request: EditorRequest) => void;
  onStopRuntime?: () => void;
  isStopping?: boolean;
  isConnected?: boolean;
};

const noticeLabels = { info: '通知', warning: '提醒', error: '错误' } as const;
const noticeColors = { info: 'text-muted', warning: 'text-warning', error: 'text-danger' } as const;

/** A presentation of the shared projection. Toasts, draft writes, and RPCs belong to the caller. */
export function PiExtensionPanel({ extensionUi, placement, providerRuntime, pendingEditorRequest,
  onReplaceEditor, onDismissEditor, onStopRuntime, isStopping = false, isConnected = true }: PiExtensionPanelProps) {
  const above = placement === 'aboveEditor';
  const widgets = Object.values(extensionUi.widgets).filter(widget => widget.placement === placement);
  const statuses = above ? Object.values(extensionUi.statuses) : [];
  const notices = above ? extensionUi.notices : [];
  const editorRequest = above ? pendingEditorRequest : undefined;
  const running = above && providerRuntime?.status === 'ready';
  const stopped = above && providerRuntime?.status === 'stopped';
  const title = above ? piExtensionPlainText(extensionUi.title || 'Pi 插件') : '插件补充信息';
  const contentCount = widgets.length + statuses.length + notices.length;
  if (!contentCount && !editorRequest && !running && !stopped && !(above && extensionUi.title)) return null;

  return <Widget className="my-2 min-w-0 gap-2 rounded-2xl p-2" data-testid={`pi-extension-${placement}`}>
    <Accordion hideSeparator defaultExpandedKeys={['content']}>
      <Accordion.Item id="content">
        <Widget.Header className="min-w-0 gap-2 px-1 py-0">
          <Accordion.Heading className="min-w-0 flex-1">
            <Accordion.Trigger className="min-w-0 gap-2 py-1.5 text-xs">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left">
                <Widget.Title className="min-w-0 break-words text-xs font-medium">{title}</Widget.Title>
                {running ? <span className="text-muted">{isConnected ? '后台运行中' : '连接中断，运行状态待确认'}</span> : null}
                {stopped ? <span className="text-muted">后台已停止</span> : null}
                {notices.length ? <span className="text-muted">{notices.length} 条通知</span> : null}
              </span>
              <Accordion.Indicator className="size-3.5 shrink-0" />
            </Accordion.Trigger>
          </Accordion.Heading>
          {running ? <Button size="sm" variant="ghost" className="shrink-0 text-xs"
            isPending={isStopping} isDisabled={!isConnected || !onStopRuntime || isStopping}
            aria-label="停止 Pi 后台运行，保留聊天历史"
            onPress={onStopRuntime}>停止后台运行</Button> : null}
        </Widget.Header>
        <Accordion.Panel>
          <Accordion.Body className="p-0 pt-1">
            <Widget.Content className="min-w-0 space-y-3 p-3 text-xs shadow-none">
              {statuses.length ? <dl className="space-y-2" aria-label="插件状态">
                {statuses.map(status => <div key={status.key} className="grid min-w-0 grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2">
                  <dt className="break-words text-muted">{piExtensionPlainText(status.key)}</dt>
                  <dd className="min-w-0 whitespace-pre-wrap break-words">{piExtensionPlainText(status.text)}</dd>
                </div>)}
              </dl> : null}
              {widgets.length ? <ScrollShadow className="max-h-52 overflow-y-auto" size={16}>
                <div className="space-y-3" aria-label="插件文本组件">
                  {widgets.map(widget => <section key={widget.key} aria-label={piExtensionPlainText(widget.key)}>
                    <p className="mb-1 break-words text-muted">{piExtensionPlainText(widget.key)}</p>
                    <p className="whitespace-pre-wrap break-words font-mono leading-relaxed">{piExtensionPlainText(widget.lines.join('\n'))}</p>
                  </section>)}
                </div>
              </ScrollShadow> : null}
              {notices.length ? <Accordion hideSeparator>
                <Accordion.Item id="notices">
                  <Accordion.Heading>
                    <Accordion.Trigger className="gap-2 py-0 text-xs">
                      <span className="flex-1 text-left">查看通知记录（{notices.length}）</span>
                      <Accordion.Indicator className="size-3.5" />
                    </Accordion.Trigger>
                  </Accordion.Heading>
                  <Accordion.Panel>
                    <Accordion.Body className="p-0 pt-2">
                      <ScrollShadow className="max-h-52 overflow-y-auto" size={16}>
                        <ol className="space-y-3" aria-label="插件通知记录">
                          {notices.map(notice => <li key={notice.eventId} className="space-y-0.5">
                            <p className={`text-[11px] ${noticeColors[notice.level]}`}>{noticeLabels[notice.level]}</p>
                            <p className="whitespace-pre-wrap break-words leading-relaxed">{piExtensionPlainText(notice.message)}</p>
                          </li>)}
                        </ol>
                      </ScrollShadow>
                    </Accordion.Body>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion> : null}
              {!contentCount ? <p className="text-muted">{running ? '等待插件消息。停止后台运行会结束插件任务，聊天历史会保留。' : '聊天历史已保留。'}</p> : null}
              {stopped && providerRuntime?.reason ? <p className="whitespace-pre-wrap break-words text-muted">{piRuntimeStopReason(providerRuntime.reason)}</p> : null}
            </Widget.Content>
          </Accordion.Body>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
    {editorRequest ? <Widget.Content className="space-y-2 p-3 text-xs shadow-none" aria-label="插件草稿建议">
      <p className="font-medium">插件希望替换当前草稿</p>
      <p className="text-muted">当前内容会保留，直到你选择替换。</p>
      <ScrollShadow className="max-h-32 overflow-y-auto" size={12}>
        <p className="whitespace-pre-wrap break-words">{piExtensionPlainText(editorRequest.text) || '（清空草稿）'}</p>
      </ScrollShadow>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" isDisabled={!onReplaceEditor}
          onPress={() => onReplaceEditor?.(editorRequest)}>替换草稿</Button>
        <Button size="sm" variant="ghost" isDisabled={!onDismissEditor}
          onPress={() => onDismissEditor?.(editorRequest)}>取消</Button>
      </div>
    </Widget.Content> : null}
  </Widget>;
}

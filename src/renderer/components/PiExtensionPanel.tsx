import { useId, useState, type ReactNode } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import type { ConversationRuntime } from '@todex/protocol/conversationRuntime';
import { Button } from '@/components/base/buttons/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cx } from '@/utils/cx';
import { useT, type MessageKey } from '../i18n';
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

const noticeLabelKeys = { info: 'pi.noticeInfo', warning: 'pi.noticeWarning', error: 'pi.noticeError' } as const satisfies Record<string, MessageKey>;
const noticeColors = { info: 'text-text-tertiary', warning: 'text-chart-8-active', error: 'text-text-error-primary' } as const;

/** A header button that shows and hides the region below it. */
function Disclosure({ label, defaultOpen = false, className, children }: {
  label: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg py-1.5 text-start text-caption-1-regular text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">{label}</span>
        <RiArrowDownSLine aria-hidden className={cx('size-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      <div id={regionId} hidden={!open}>{open ? children : null}</div>
    </div>
  );
}

/** A presentation of the shared projection. Toasts, draft writes, and RPCs belong to the caller. */
export function PiExtensionPanel({ extensionUi, placement, providerRuntime, pendingEditorRequest,
  onReplaceEditor, onDismissEditor, onStopRuntime, isStopping = false, isConnected = true }: PiExtensionPanelProps) {
  const t = useT();
  const above = placement === 'aboveEditor';
  const widgets = Object.values(extensionUi.widgets).filter(widget => widget.placement === placement);
  const statuses = above ? Object.values(extensionUi.statuses) : [];
  const notices = above ? extensionUi.notices : [];
  const editorRequest = above ? pendingEditorRequest : undefined;
  const running = above && providerRuntime?.status === 'ready';
  const stopped = above && providerRuntime?.status === 'stopped';
  const title = above ? piExtensionPlainText(extensionUi.title || t('pi.defaultTitle')) : t('pi.subtitle');
  const contentCount = widgets.length + statuses.length + notices.length;
  if (!contentCount && !editorRequest && !running && !stopped && !(above && extensionUi.title)) return null;

  return <Card variant="secondary" className="my-2 flex min-w-0 flex-col gap-2 rounded-2xl p-2 text-caption-1-regular" data-testid={`pi-extension-${placement}`}>
    <div className="flex min-w-0 items-start gap-2 px-1">
      <Disclosure
        className="min-w-0 flex-1"
        label={<>
          <span className="min-w-0 break-words text-caption-1-medium text-text-primary">{title}</span>
          {running ? <span className="text-text-tertiary">{isConnected ? t('pi.running') : t('pi.disconnected')}</span> : null}
          {stopped ? <span className="text-text-tertiary">{t('pi.stopped')}</span> : null}
          {notices.length ? <span className="text-text-tertiary">{t('pi.noticeCount', { count: notices.length })}</span> : null}
        </>}
      >
        <div className="mt-1 min-w-0 space-y-3 rounded-xl bg-background-primary-default p-3">
          {statuses.length ? <dl className="space-y-2" aria-label={t('pi.statusLabel')}>
            {statuses.map(status => <div key={status.key} className="grid min-w-0 grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2">
              <dt className="break-words text-text-tertiary">{piExtensionPlainText(status.key)}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-text-primary">{piExtensionPlainText(status.text)}</dd>
            </div>)}
          </dl> : null}
          {widgets.length ? <ScrollArea className="max-h-52">
            <div className="space-y-3" aria-label={t('pi.widgetsLabel')}>
              {widgets.map(widget => <section key={widget.key} aria-label={piExtensionPlainText(widget.key)}>
                <p className="mb-1 break-words text-text-tertiary">{piExtensionPlainText(widget.key)}</p>
                <p className="whitespace-pre-wrap break-words font-mono leading-relaxed text-text-primary">{piExtensionPlainText(widget.lines.join('\n'))}</p>
              </section>)}
            </div>
          </ScrollArea> : null}
          {notices.length ? <Disclosure label={<span>{t('pi.viewNotices', { count: notices.length })}</span>}>
            <ScrollArea className="mt-1 max-h-52">
              <ol className="space-y-3" aria-label={t('pi.noticesLabel')}>
                {notices.map(notice => <li key={notice.eventId} className="space-y-0.5">
                  <p className={cx('text-caption-2-regular', noticeColors[notice.level])}>{t(noticeLabelKeys[notice.level])}</p>
                  <p className="whitespace-pre-wrap break-words leading-relaxed text-text-primary">{piExtensionPlainText(notice.message)}</p>
                </li>)}
              </ol>
            </ScrollArea>
          </Disclosure> : null}
          {!contentCount ? <p className="text-text-tertiary">{running ? t('pi.waitingMessages') : t('pi.historyKept')}</p> : null}
          {stopped && providerRuntime?.reason ? <p className="whitespace-pre-wrap break-words text-text-tertiary">{piRuntimeStopReason(providerRuntime.reason)}</p> : null}
        </div>
      </Disclosure>
      {running ? <Button size="xs" variant="ghost" className="mt-0.5 shrink-0"
        disabled={!isConnected || !onStopRuntime || isStopping} aria-busy={isStopping || undefined}
        aria-label={t('pi.stopAria')}
        onClick={onStopRuntime}>{t('pi.stop')}</Button> : null}
    </div>
    {editorRequest ? <div className="space-y-2 rounded-xl bg-background-primary-default p-3" aria-label={t('pi.draftSuggestion')}>
      <p className="text-caption-1-medium text-text-primary">{t('pi.replaceDraftTitle')}</p>
      <p className="text-text-tertiary">{t('pi.replaceDraftHint')}</p>
      <ScrollArea className="max-h-32">
        <p className="whitespace-pre-wrap break-words text-text-primary">{piExtensionPlainText(editorRequest.text) || t('pi.clearDraft')}</p>
      </ScrollArea>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="secondary" disabled={!onReplaceEditor}
          onClick={() => onReplaceEditor?.(editorRequest)}>{t('pi.replaceDraft')}</Button>
        <Button size="xs" variant="ghost" disabled={!onDismissEditor}
          onClick={() => onDismissEditor?.(editorRequest)}>{t('common.cancel')}</Button>
      </div>
    </div> : null}
  </Card>;
}

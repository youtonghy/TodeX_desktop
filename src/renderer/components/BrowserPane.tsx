import { useCallback, useEffect, useRef, useState } from 'react';
import { RiArrowLeftLine, RiFocus3Line, RiGlobalLine, RiRefreshLine } from '@remixicon/react';
import { Input } from '@/components/base/input/input';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { isLoopbackUrl } from '@todex/protocol/mobileParity';
import { ExpandableAction } from './ExpandableAction';
import { useNoticeToast } from './NoticeToast';
import { useNativeViewHost } from './nativeViewHost';
import { backendApi, previewBackendProfile } from '../session/helpers';
import type { BrowserPaneProps } from '../platform/types';
import { t, useT } from '../i18n';

/** A Workbench browser tab. The page is a native view drawn by the main
 * process (see `previewViews.ts`); this pane holds the address bar and the
 * rectangle the view fills. Only loopback pages and workspace HTML files load. */
export function BrowserPane({ itemId, isActive, workspacePath, session, target, onTargetChange }: BrowserPaneProps) {
  const t = useT();
  const preview = window.todexDesktop.preview;
  const targetChangeRef = useRef(onTargetChange);
  targetChangeRef.current = onTargetChange;
  // Every URL source (typed, chat link, restored layout) must stay loopback.
  const targetUrl = target?.url && isLoopbackUrl(target.url) ? target.url : undefined;
  // A new tab starts blank (address bar + empty state) and loads nothing
  // until an address is entered.
  const [draft, setDraft] = useState(targetUrl ?? '');
  const [hasPage, setHasPage] = useState(false);
  const [error, setError] = useState('');
  const [inspect, setInspect] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const loadedUrlRef = useRef('');
  useNoticeToast(error, { variant: 'danger', scope: workspacePath });
  const { hostRef, covered, still } = useNativeViewHost(hasPage ? itemId : undefined, isActive, preview);

  // Loopback requests go through the backend, so a page served on its host
  // loads here wherever the backend runs.
  const backend = previewBackendProfile(session.settings);
  const backendKey = JSON.stringify(backend);
  const backendReady = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    backendReady.current = preview.setBackend(backend).catch(() => undefined);
  }, [backendKey, preview]);

  const load = useCallback((page: { url: string } | { html: string }) => {
    setError('');
    setHasPage(true);
    void backendReady.current
      .then(() => preview.open(itemId, page))
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('workbench.invalidUrl')));
  }, [itemId, preview]);

  const navigateTo = useCallback((input: string) => {
    const trimmed = input.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(t('workbench.httpOnly'));
      if (!isLoopbackUrl(parsed)) throw new Error(t('workbench.loopbackOnly'));
      setDraft(parsed.toString());
      targetChangeRef.current?.({ url: parsed.toString() });
      load({ url: parsed.toString() });
    } catch (reason) {
      toast.danger(reason instanceof Error ? reason.message : t('workbench.invalidUrl'));
    }
  }, [load]);

  useEffect(() => {
    if (target?.url) {
      if (!isLoopbackUrl(target.url)) {
        setError(t('workbench.loopbackOnly'));
        return;
      }
      if (target.url === loadedUrlRef.current) return;
      targetChangeRef.current?.(target);
      setDraft(target.url);
      load({ url: target.url });
      return;
    }
    if (!target?.filePath) return;
    targetChangeRef.current?.(target);
    setDraft(target.filePath);
    const api = backendApi(session.settings);
    void api.readWorkspaceFile(target.filePath)
      .then((file) => {
        if (!file.text) throw new Error(t('workbench.webFileNotText'));
        load({ html: file.text });
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : t('workbench.webFileReadFailed')));
  }, [session.settings.deviceSecret, session.settings.serverUrl, target?.filePath, target?.url]);

  // The page navigates on its own (links, redirects): follow it.
  useEffect(() => preview.onState((state) => {
    if (state.key !== itemId) return;
    if (state.error) setError(state.error);
    setCanGoBack(state.canGoBack);
    if (state.url && state.url !== loadedUrlRef.current) {
      loadedUrlRef.current = state.url;
      setDraft(state.url);
      targetChangeRef.current?.({ url: state.url });
    }
  }), [itemId, preview]);

  const appendReference = useCallback((picked: { tag: string; id: string; text: string }) => {
    const reference = t('workbench.webElement', { tag: picked.tag, id: picked.id ? `#${picked.id}` : '', text: picked.text ? `: ${picked.text}` : '' });
    const conversationId = session.activeConversation?.id;
    if (conversationId) {
      session.setConversationChatDraft(conversationId, (current) => `${current}${current ? '\n' : ''}${reference}`);
    }
  }, [session.activeConversation?.id, session.setConversationChatDraft]);
  useEffect(() => preview.onPicked((picked) => {
    if (picked.key === itemId) appendReference(picked);
  }), [appendReference, itemId, preview]);

  useEffect(() => {
    if (!hasPage) return;
    const rootStyle = getComputedStyle(document.documentElement);
    const tokenColor = (name: string) => rootStyle.getPropertyValue(name).trim() || '#128DDB';
    void preview.inspect(itemId, inspect ? { hover: tokenColor('--color-chart-4'), selected: tokenColor('--color-accent-500') } : null)
      .catch(() => toast.danger(t('workbench.inspectBlocked')));
  }, [hasPage, inspect, itemId, preview]);

  useEffect(() => () => { void preview.close(itemId); }, [itemId, preview]);

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        {hasPage && canGoBack ? (
          <ExpandableAction
            icon={RiArrowLeftLine}
            iconClassName="rtl:-scale-x-100"
            label={t('workbench.back')}
            onClick={() => { void preview.goBack(itemId); }}
            aria-label={t('workbench.back')}
          />
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigateTo(draft);
          }}
          className="min-w-0 flex-1"
        >
          <Input
            aria-label={t('workbench.address')}
            size="small"
            value={draft}
            onChange={setDraft}
            placeholder="http://127.0.0.1:..."
            inputClassName="text-caption-1-regular"
          />
        </form>
        <div className="flex shrink-0 items-center gap-2">
          <ExpandableAction
            icon={RiRefreshLine}
            label={t('workbench.refresh')}
            disabled={!hasPage}
            onClick={() => { void preview.reload(itemId); }}
            aria-label={t('workbench.refreshPage')}
          />
          <ExpandableAction
            tone={inspect ? 'primary' : 'secondary'}
            icon={RiFocus3Line}
            label={inspect ? t('workbench.exitInspect') : t('workbench.selectElement')}
            disabled={!hasPage}
            onClick={() => setInspect((current) => !current)}
            aria-label={inspect ? t('workbench.exitInspect') : t('workbench.selectElement')}
          />
        </div>
      </div>
      {hasPage ? (
        <div ref={hostRef} className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border-button-default bg-background-primary-default" aria-label={t('workbench.webPreview')}>
          {covered && still ? <img src={still} alt="" className="size-full object-contain object-top" /> : null}
        </div>
      ) : (
        <EmptyState
          size="sm"
          icon={RiGlobalLine}
          title={t('workbench.browserPreview')}
          description={t('workbench.browserPreviewHint', { workspace: workspacePath || t('workbench.noWorkspace') })}
          className="min-h-0 flex-1 rounded-2xl bg-background-secondary-default px-6"
        />
      )}
    </div>
  );
}

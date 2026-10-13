import { useEffect, useState } from 'react';
import { RiCheckboxBlankLine, RiCloseLine, RiFileCopyLine, RiMenuLine, RiSubtractLine } from '@remixicon/react';
import { IconAction } from '@/components/ui/icon-action';
import { useT } from '../i18n';
import { AppIcon } from './AppIcon';

type WindowState = { maximized: boolean; fullScreen: boolean };

/** Follows `document.title`, which App keeps on the active conversation. */
function useDocumentTitle(): string {
  const [title, setTitle] = useState(() => document.title);
  useEffect(() => {
    const element = document.querySelector('title');
    if (!element) return;
    const observer = new MutationObserver(() => setTitle(document.title));
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    setTitle(document.title);
    return () => observer.disconnect();
  }, []);
  return title;
}

function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ maximized: false, fullScreen: false });
  useEffect(() => {
    let live = true;
    void window.todexDesktop.app.windowState().then((next) => { if (live) setState(next); });
    const off = window.todexDesktop.app.onWindowState(setState);
    return () => { live = false; off(); };
  }, []);
  return state;
}

/**
 * Title bar of the frameless Linux window (`windowChrome: 'custom'`): brand
 * mark and window title on a drag strip, the application menu, and the
 * minimize / maximize / close buttons the window manager no longer draws.
 */
export function WindowControlBar() {
  const t = useT();
  const title = useDocumentTitle();
  const { maximized, fullScreen } = useWindowState();
  const app = window.todexDesktop.app;
  const restore = maximized || fullScreen;

  return (
    <div className="window-drag flex h-9 shrink-0 select-none items-center gap-2 bg-background-full ps-3 pe-1.5">
      <AppIcon className="size-4" />
      <IconAction
        icon={RiMenuLine}
        size="sm"
        aria-label={t('window.menu')}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          app.popupMenu(rect.left, rect.bottom + 4);
        }}
      />
      <p className="min-w-0 flex-1 truncate text-center text-caption-1-medium text-text-secondary">{title}</p>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconAction icon={RiSubtractLine} size="sm" aria-label={t('window.minimize')} onClick={app.minimize} />
        <IconAction
          icon={restore ? RiFileCopyLine : RiCheckboxBlankLine}
          size="sm"
          aria-label={t(restore ? 'window.restore' : 'window.maximize')}
          iconClassName={restore ? '-scale-x-100' : 'size-3.5'}
          onClick={app.toggleMaximize}
        />
        <IconAction
          icon={RiCloseLine}
          size="sm"
          aria-label={t('window.close')}
          className="hover:bg-background-tertiary-error hover:text-foreground-icon-error active:bg-background-quaternary-error"
          onClick={app.closeWindow}
        />
      </div>
    </div>
  );
}

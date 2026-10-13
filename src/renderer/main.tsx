import { StrictMode, useCallback, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectionProvider } from '@/components/foundations/direction/direction';
import { TemplateCopyProvider } from '@/components/foundations/template-copy/template-copy';
import { App } from './App';
import { WindowControlBar } from './components/WindowControlBar';
import { installBrowserDesktopBridge } from './lib/browserDesktop';
import { installRendererDebugLogging } from './lib/debugLogger';
import { getLocale, subscribeLocale, t } from './i18n';
import { applyAppearance } from './lib/appearance';
import '@fontsource-variable/inter';
import './styles/global.css';

/** Built-in English copy of BoardUI components (e.g. the date picker's
 * footer) mapped to the app's own strings; anything else passes through. */
const TEMPLATE_COPY = {
  'Select date': 'common.selectDate',
  Cancel: 'common.cancel',
  Apply: 'common.apply',
  Date: 'common.date',
} as const;

/** Keeps BoardUI's text direction, React Aria locale, portalled menus and
 * built-in copy in step with the in-app language. */
function Root() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  // Re-created per locale so translated copy re-renders on a language switch.
  const translate = useCallback((text: string) => {
    const key = TEMPLATE_COPY[text as keyof typeof TEMPLATE_COPY];
    return key ? t(key) : text;
  }, [locale]);
  return (
    <DirectionProvider locale={locale}>
      <TemplateCopyProvider translate={translate}>
        {window.todexDesktop.app.windowChrome === 'custom' ? (
          // Frameless Linux window: the app draws its own title bar above.
          <div className="flex h-full flex-col bg-background-full">
            <WindowControlBar />
            <div className="min-h-0 flex-1"><App /></div>
          </div>
        ) : <App />}
      </TemplateCopyProvider>
    </DirectionProvider>
  );
}

async function boot() {
  // Dev-only demo preview: `?demo` serves fixture data instead of a backend.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo')) {
    const { installDemoMode } = await import('./demo');
    installDemoMode();
  }

  installBrowserDesktopBridge();
  installRendererDebugLogging();
  applyAppearance();

  // Expose the window chrome so CSS can reserve space for overlaid window
  // controls (macOS traffic lights) and mark drag regions.
  document.documentElement.dataset.windowChrome = window.todexDesktop.app.windowChrome;

  // Push the renderer locale to the main process so dialogs and the update
  // menu follow the in-app language choice.
  window.todexDesktop.locale.set(getLocale());
  subscribeLocale(() => window.todexDesktop.locale.set(getLocale()));

  const root = document.getElementById('root');
  if (!root) {
    throw new Error('root element missing');
  }

  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

void boot();

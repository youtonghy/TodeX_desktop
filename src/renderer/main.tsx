import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installBrowserDesktopBridge } from './lib/browserDesktop';
import { installRendererDebugLogging } from './lib/debugLogger';
import { getLocale, subscribeLocale } from './i18n';
import './styles/global.css';

installBrowserDesktopBridge();
installRendererDebugLogging();

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
    <App />
  </StrictMode>,
);

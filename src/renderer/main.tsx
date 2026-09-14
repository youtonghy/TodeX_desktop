import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installBrowserDesktopBridge } from './lib/browserDesktop';
import { installRendererDebugLogging } from './lib/debugLogger';
import { getLocale, subscribeLocale } from './i18n';
import './styles/global.css';

installBrowserDesktopBridge();
installRendererDebugLogging();

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

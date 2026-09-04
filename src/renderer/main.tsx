import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installBrowserDesktopBridge } from './lib/browserDesktop';
import { installRendererDebugLogging } from './lib/debugLogger';
import './styles/global.css';

installBrowserDesktopBridge();
installRendererDebugLogging();

const root = document.getElementById('root');
if (!root) {
  throw new Error('root element missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

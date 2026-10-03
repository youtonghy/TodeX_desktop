import { WebContentsView, type BrowserWindow, type Rectangle } from 'electron';
import { isLoopbackUrl } from '@todex/protocol/mobileParity';

/** Workbench preview pages share one partition, apart from the app's own storage. */
const PARTITION = 'persist:todex-preview';
const INSPECT_WORLD = 'todex-inspect';
const INSPECT_BINDING = '__todexInspect';

export type PreviewTarget = { url: string } | { html: string };
export type PreviewState = { key: string; url: string; title: string; loading: boolean; error?: string };
export type PickedElement = { key: string; tag: string; id: string; text: string };
export type InspectColors = { hover: string; selected: string };

type Preview = { view: WebContentsView; inspect: InspectColors | null; contextId?: number; listening: boolean };

/** Element picker, run in an isolated world: same DOM, none of the page's JS. */
function pickerScript(colors: InspectColors): string {
  return `(() => {
  if (window.__todexPicker) window.__todexPicker.stop();
  const doc = document;
  const overlay = (color) => {
    const node = doc.createElement('div');
    node.setAttribute('aria-hidden', 'true');
    Object.assign(node.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', border: '2px solid ' + color, boxSizing: 'border-box', display: 'none' });
    doc.documentElement.appendChild(node);
    return node;
  };
  const hover = overlay(${JSON.stringify(colors.hover)});
  const chosen = overlay(${JSON.stringify(colors.selected)});
  let hovered = null, selected = null, anchor = null;
  const place = (node, element) => {
    if (!element || !element.isConnected) { node.style.display = 'none'; return; }
    const r = element.getBoundingClientRect();
    Object.assign(node.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const isElement = (value) => value instanceof HTMLElement;
  const previousCursor = doc.documentElement.style.cursor;
  doc.documentElement.style.cursor = 'crosshair';
  const move = (event) => {
    const element = isElement(event.target) ? event.target : null;
    hovered = element;
    if (!selected) anchor = element;
    place(hover, element === selected ? null : element);
  };
  const click = (event) => {
    event.preventDefault(); event.stopPropagation();
    if (!isElement(event.target)) return;
    selected = event.target; anchor = event.target;
    place(chosen, selected); place(hover, null);
    const text = (selected.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160);
    ${INSPECT_BINDING}(JSON.stringify({ tag: selected.tagName.toLowerCase(), id: selected.id || '', text }));
  };
  const wheel = (event) => {
    const current = selected || hovered;
    if (!current) return;
    event.preventDefault();
    const start = anchor || current;
    anchor = start;
    const next = event.deltaY > 0
      ? (current.parentElement && current.parentElement !== doc.documentElement ? current.parentElement : null)
      : (start && current !== start ? Array.from(current.children).find((child) => child.contains(start)) : current.firstElementChild);
    if (!isElement(next)) return;
    if (selected) { selected = next; place(chosen, next); } else { hovered = next; place(hover, next); }
  };
  const reposition = () => { place(hover, hovered === selected ? null : hovered); place(chosen, selected); };
  doc.addEventListener('mousemove', move, true);
  doc.addEventListener('click', click, true);
  window.addEventListener('wheel', wheel, { capture: true, passive: false });
  doc.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  window.__todexPicker = { stop() {
    doc.removeEventListener('mousemove', move, true);
    doc.removeEventListener('click', click, true);
    window.removeEventListener('wheel', wheel, true);
    doc.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    doc.documentElement.style.cursor = previousCursor;
    hover.remove(); chosen.remove();
    delete window.__todexPicker;
  } };
})()`;
}

/**
 * The user's Workbench browser tabs, as native views like the agent's. Only
 * loopback pages (and workspace HTML files) load at the top level.
 */
export class PreviewViews {
  private readonly previews = new Map<string, Preview>();

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly emitState: (state: PreviewState) => void,
    private readonly emitPicked: (picked: PickedElement) => void,
  ) {}

  async open(key: string, target: PreviewTarget): Promise<void> {
    if ('url' in target && !isLoopbackUrl(target.url)) throw new Error('only local addresses can be previewed');
    const preview = this.previews.get(key) ?? this.create(key);
    const url = 'url' in target ? target.url : `data:text/html;charset=utf-8,${encodeURIComponent(target.html)}`;
    try {
      await preview.view.webContents.loadURL(url);
    } catch (error) {
      // An error page is still shown; report it with the state.
      this.emit(key, error instanceof Error ? error.message : String(error));
    }
  }

  reload(key: string): void {
    this.previews.get(key)?.view.webContents.reload();
  }

  setBounds(key: string, bounds: Rectangle | null): void {
    const preview = this.previews.get(key);
    if (!preview) return;
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      preview.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
      preview.view.setVisible(true);
    } else {
      preview.view.setVisible(false);
    }
  }

  async capture(key: string): Promise<string | null> {
    const preview = this.previews.get(key);
    if (!preview) return null;
    const image = await preview.view.webContents.capturePage();
    return image.isEmpty() ? null : image.toDataURL();
  }

  async inspect(key: string, colors: InspectColors | null): Promise<void> {
    const preview = this.previews.get(key);
    if (!preview) return;
    preview.inspect = colors;
    const debuggerApi = preview.view.webContents.debugger;
    if (!colors) {
      if (debuggerApi.isAttached()) {
        if (preview.contextId !== undefined) {
          await debuggerApi.sendCommand('Runtime.evaluate', { expression: 'window.__todexPicker && window.__todexPicker.stop()', contextId: preview.contextId }).catch(() => undefined);
        }
        debuggerApi.detach();
      }
      preview.contextId = undefined;
      return;
    }
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach('1.3');
      await debuggerApi.sendCommand('Runtime.enable');
      await debuggerApi.sendCommand('Runtime.addBinding', { name: INSPECT_BINDING, executionContextName: INSPECT_WORLD });
    }
    if (!preview.listening) {
      preview.listening = true;
      debuggerApi.on('message', (_event, method, params) => {
        if (method === 'Runtime.bindingCalled' && params?.name === INSPECT_BINDING && params.executionContextId === preview.contextId) {
          try {
            const value = JSON.parse(String(params.payload)) as { tag?: unknown; id?: unknown; text?: unknown };
            this.emitPicked({ key, tag: String(value.tag ?? ''), id: String(value.id ?? ''), text: String(value.text ?? '') });
          } catch {
            // Ignore malformed payloads.
          }
        }
      });
    }
    await this.injectPicker(preview);
  }

  close(key: string): void {
    const preview = this.previews.get(key);
    if (!preview) return;
    this.previews.delete(key);
    this.window()?.contentView.removeChildView(preview.view);
    preview.view.webContents.close();
  }

  closeAll(): void {
    for (const key of [...this.previews.keys()]) this.close(key);
  }

  private async injectPicker(preview: Preview): Promise<void> {
    if (!preview.inspect) return;
    const debuggerApi = preview.view.webContents.debugger;
    const { frameTree } = await debuggerApi.sendCommand('Page.getFrameTree') as { frameTree: { frame: { id: string } } };
    const { executionContextId } = await debuggerApi.sendCommand('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: INSPECT_WORLD,
    }) as { executionContextId: number };
    preview.contextId = executionContextId;
    await debuggerApi.sendCommand('Runtime.evaluate', { expression: pickerScript(preview.inspect), contextId: executionContextId });
  }

  private create(key: string): Preview {
    const window = this.window();
    if (!window) throw new Error('the TodeX window is not open');
    const view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const preview: Preview = { view, inspect: null, listening: false };
    const contents = view.webContents;
    const allowed = (url: string) => isLoopbackUrl(url) || url.startsWith('data:text/html') || url === 'about:blank';
    contents.on('will-navigate', (event, url) => {
      if (!allowed(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event) => {
      if (event.isMainFrame && !allowed(event.url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isLoopbackUrl(url)) void contents.loadURL(url).catch(() => undefined);
      return { action: 'deny' };
    });
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    for (const event of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'page-title-updated'] as const) {
      contents.on(event as 'did-start-loading', () => this.emit(key));
    }
    // A new document needs the picker again.
    contents.on('did-finish-load', () => { void this.injectPicker(preview).catch(() => undefined); });
    contents.on('render-process-gone', () => this.close(key));
    view.setVisible(false);
    window.contentView.addChildView(view);
    this.previews.set(key, preview);
    return preview;
  }

  private emit(key: string, error?: string): void {
    const preview = this.previews.get(key);
    if (!preview) return;
    const contents = preview.view.webContents;
    const url = contents.getURL();
    this.emitState({
      key,
      url: url.startsWith('data:') ? '' : url,
      title: contents.getTitle(),
      loading: contents.isLoading(),
      ...(error ? { error } : {}),
    });
  }
}

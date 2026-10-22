import { useCallback, useEffect, useRef, useState } from 'react';
import { RiArrowDownSLine, RiArrowUpSLine, RiCloseLine, RiSearchLine } from '@remixicon/react';
import { ClipboardAddon, type ClipboardSelectionType, type IClipboardProvider } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { ProgressAddon } from '@xterm/addon-progress';
import { SearchAddon } from '@xterm/addon-search';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IDisposable, type IMarker, type ITheme } from '@xterm/xterm';
import type { TerminalStream } from '@todex/protocol/terminalStream';
import {
  findFileLinks,
  isTerminalImageType,
  parseOsc133,
  parseOsc7,
  parseTerminalNotification,
  pasteNeedsConfirmation,
  sanitizePaste,
  type TerminalNotification,
} from '@todex/protocol/terminalText';
import { Input } from '@/components/base/input/input';
import { ConfirmDialog } from '@/components/ui/modal';
import { ContextMenu, Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { IconAction } from '@/components/ui/icon-action';
import { cx } from '@/utils/cx';
import { useT } from '../i18n';
import { terminalFontFamily, useTerminalPreferences } from '../session/terminalPreferences';

export type TerminalCommandFinished = { exitCode: number | null; durationMs: number };

export type XtermTerminalHandlers = {
  onData: (data: string) => void;
  onResize: (rows: number, cols: number) => void;
  /** Clear was chosen (menu or shortcut); the view is already cleared. */
  onClear?: () => void;
  /** OSC 7: the shell's working directory. */
  onCwd?: (path: string) => void;
  onTitle?: (title: string) => void;
  /** Output arrived (at most a few times a second). */
  onActivity?: () => void;
  onBell?: () => void;
  /** OSC 133: a command started (true) or the prompt is back (false). */
  onCommandRunning?: (running: boolean) => void;
  onCommandFinished?: (result: TerminalCommandFinished) => void;
  /** OSC 9 / OSC 777 notifications from programs. */
  onNotification?: (notification: TerminalNotification) => void;
  onProgress?: (progress: { state: number; value: number }) => void;
  /** Ctrl/⌘-click on a `path:line:col` reference; the receiver resolves it. */
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  /** The kept output lost its start: ask the backend for the screen instead.
   * True when a snapshot is on its way (it arrives as a reset). */
  onRequestSnapshot?: () => boolean;
  /** Images pasted (with no text) or dropped: store them where the program
   * can read them and resolve with their paths, which are then pasted. */
  onPasteImages?: (files: File[]) => Promise<string[]>;
};

type Props = XtermTerminalHandlers & {
  stream: TerminalStream;
  isActive: boolean;
  isDisabled?: boolean;
};

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** PTY resizes go out at most this often; the last size wins. */
const RESIZE_THROTTLE_MS = 25;
const ACTIVITY_THROTTLE_MS = 500;

/** Resolves CSS colors (tokens included) to `#rrggbb` / `#rrggbbaa`, the
 * format xterm's renderers and search decorations require. */
function resolveColors<K extends string>(colors: Record<K, string>): Record<K, string> {
  const resolved = {} as Record<K, string>;
  const probe = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  document.body.appendChild(probe);
  try {
    for (const key of Object.keys(colors) as K[]) {
      probe.style.color = '';
      probe.style.color = colors[key];
      const computed = window.getComputedStyle(probe).color;
      if (!ctx || !computed) {
        resolved[key] = '#000000';
        continue;
      }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = computed;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      const hex = (value: number) => value.toString(16).padStart(2, '0');
      resolved[key] = `#${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ''}`;
    }
  } finally {
    probe.remove();
  }
  return resolved;
}

const THEME_TOKENS = {
  background: 'var(--color-background-secondary-default)',
  foreground: 'var(--color-text-primary)',
  cursor: 'var(--color-terminal-cursor)',
  cursorAccent: 'var(--color-background-secondary-default)',
  selectionBackground: 'var(--color-terminal-selection)',
  black: 'var(--color-terminal-black)',
  red: 'var(--color-terminal-red)',
  green: 'var(--color-terminal-green)',
  yellow: 'var(--color-terminal-yellow)',
  blue: 'var(--color-terminal-blue)',
  magenta: 'var(--color-terminal-magenta)',
  cyan: 'var(--color-terminal-cyan)',
  white: 'var(--color-terminal-white)',
  brightBlack: 'var(--color-terminal-bright-black)',
  brightRed: 'var(--color-terminal-bright-red)',
  brightGreen: 'var(--color-terminal-bright-green)',
  brightYellow: 'var(--color-terminal-bright-yellow)',
  brightBlue: 'var(--color-terminal-bright-blue)',
  brightMagenta: 'var(--color-terminal-bright-magenta)',
  brightCyan: 'var(--color-terminal-bright-cyan)',
  brightWhite: 'var(--color-terminal-bright-white)',
  markSuccess: 'var(--color-terminal-mark-success)',
  markFailure: 'var(--color-terminal-mark-failure)',
  searchMatch: 'var(--color-terminal-search-match)',
  searchActive: 'var(--color-terminal-search-active)',
};

type TerminalColors = Record<keyof typeof THEME_TOKENS, string>;

function terminalTheme(colors: TerminalColors): ITheme {
  const { markSuccess: _success, markFailure: _failure, searchMatch: _match, searchActive: _active, ...theme } = colors;
  return theme;
}

/** `#rrggbb` without alpha, as overview rulers and search highlights need. */
const opaque = (color: string) => color.slice(0, 7);

/** Maps string offsets of a buffer line to its cells (a wide character takes
 * two cells but appears once in the line's text). */
function cellOffsets(terminal: Terminal, y: number): { text: string; cellAt: number[] } | null {
  const line = terminal.buffer.active.getLine(y);
  if (!line) return null;
  let text = '';
  const cellAt: number[] = [];
  for (let x = 0; x < line.length; x += 1) {
    const cell = line.getCell(x);
    if (cell?.getWidth() === 0) continue;
    const value = cell?.getChars() || ' ';
    for (let i = 0; i < value.length; i += 1) cellAt.push(x);
    text += value;
  }
  cellAt.push(line.length);
  return { text, cellAt };
}

function isOpenGesture(event: MouseEvent) {
  return IS_MAC ? event.metaKey : event.ctrlKey;
}

export function XtermTerminal({ stream, isActive, isDisabled = false, ...handlers }: Props) {
  const t = useT();
  const preferences = useTerminalPreferences();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);
  const webglFailedRef = useRef(false);
  const colorsRef = useRef<TerminalColors | null>(null);
  const promptMarkersRef = useRef<IMarker[]>([]);
  const handlersRef = useRef(handlers);
  const isActiveRef = useRef(isActive);
  const preferencesRef = useRef(preferences);
  handlersRef.current = handlers;
  isActiveRef.current = isActive;
  preferencesRef.current = preferences;

  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<{ index: number; count: number } | null>(null);
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);
  const [linkHint, setLinkHint] = useState('');

  const pasteText = useCallback((text: string) => {
    const terminal = terminalRef.current;
    if (!terminal || !text || terminal.options.disableStdin) return;
    if (pasteNeedsConfirmation(text, terminal.modes.bracketedPasteMode)) {
      setPendingPaste(text);
      return;
    }
    terminal.paste(sanitizePaste(text));
  }, []);

  /** Pastes each stored image's path on its own, as agent CLIs expect. */
  const pasteImages = useCallback(async (files: File[]) => {
    const upload = handlersRef.current.onPasteImages;
    if (!upload || !files.length || terminalRef.current?.options.disableStdin) return;
    let paths: string[];
    try {
      paths = await upload(files);
    } catch {
      return;
    }
    for (const path of paths) terminalRef.current?.paste(path);
    terminalRef.current?.focus();
  }, []);

  const copySelection = useCallback(() => {
    const selection = terminalRef.current?.getSelection() ?? '';
    if (selection) void navigator.clipboard?.writeText(selection).catch(() => undefined);
    return Boolean(selection);
  }, []);

  const requestPaste = useCallback(() => {
    terminalRef.current?.focus();
    // Desktop: a native paste event, so no clipboard read permission is
    // needed; it reaches the paste listener like a keyboard paste.
    const desktopPaste = (window as { todexDesktop?: { app?: { paste?: () => void } } }).todexDesktop?.app?.paste;
    if (desktopPaste) {
      desktopPaste();
      return;
    }
    void navigator.clipboard?.readText().then(pasteText).catch(() => undefined);
  }, [pasteText]);

  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
    promptMarkersRef.current = [];
    handlersRef.current.onClear?.();
  }, []);

  const jumpToPrompt = useCallback((direction: -1 | 1) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const top = terminal.buffer.active.viewportY;
    const lines = promptMarkersRef.current.filter((marker) => !marker.isDisposed).map((marker) => marker.line);
    const target = direction < 0
      ? [...lines].reverse().find((line) => line < top)
      : lines.find((line) => line > top);
    if (target !== undefined) terminal.scrollToLine(target);
    else if (direction > 0) terminal.scrollToBottom();
  }, []);

  const openFind = useCallback(() => {
    setFindOpen(true);
    const selection = terminalRef.current?.getSelection() ?? '';
    if (selection && !selection.includes('\n')) setFindQuery(selection);
  }, []);

  const runSearch = useCallback((query: string, direction: 'next' | 'previous', incremental = false) => {
    const search = searchAddonRef.current;
    const colors = colorsRef.current;
    if (!search) return;
    if (!query) {
      search.clearDecorations();
      setFindResult(null);
      return;
    }
    const options = {
      incremental,
      decorations: colors ? {
        matchBackground: opaque(colors.searchMatch),
        matchOverviewRuler: opaque(colors.searchMatch),
        activeMatchBackground: opaque(colors.searchActive),
        activeMatchColorOverviewRuler: opaque(colors.searchActive),
      } : undefined,
    };
    if (direction === 'next') search.findNext(query, options);
    else search.findPrevious(query, options);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindResult(null);
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }, []);

  // The terminal's key and paste handlers read the latest callbacks here.
  const actionsRef = useRef({ copySelection, openFind, clearTerminal, jumpToPrompt, pasteText, pasteImages });
  actionsRef.current = { copySelection, openFind, clearTerminal, jumpToPrompt, pasteText, pasteImages };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initial = preferencesRef.current;
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: initial.cursorStyle,
      disableStdin: isDisabled,
      fontFamily: terminalFontFamily(initial.fontFamily),
      fontSize: initial.fontSize,
      lineHeight: 1.25,
      scrollback: 10_000,
      minimumContrastRatio: 4.5,
      linkHandler: {
        // OSC 8 hyperlinks open like other links (http(s) only, see main).
        activate: (event, uri) => {
          if (isOpenGesture(event)) window.open(uri, '_blank', 'noopener');
        },
        hover: (_event, uri) => setLinkHint(uri),
        leave: () => setLinkHint(''),
      },
    });
    colorsRef.current = resolveColors(THEME_TOKENS);
    terminal.options.theme = terminalTheme(colorsRef.current);

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const progressAddon = new ProgressAddon();
    const clipboardProvider: IClipboardProvider = {
      // Programs may set the clipboard (OSC 52) but never read it.
      readText: () => '',
      writeText: (_selection: ClipboardSelectionType, text: string) => navigator.clipboard?.writeText(text).catch(() => undefined),
    };
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(progressAddon);
    terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));
    terminal.loadAddon(new UnicodeGraphemesAddon());
    terminal.loadAddon(new WebLinksAddon((event, uri) => {
      if (isOpenGesture(event)) window.open(uri, '_blank', 'noopener');
    }, {
      hover: (_event, uri) => setLinkHint(uri),
      leave: () => setLinkHint(''),
    }));
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    const disposables: IDisposable[] = [];
    const on = (disposable: IDisposable) => { disposables.push(disposable); };

    // `path:line:col` references in the output.
    on(terminal.registerLinkProvider({
      provideLinks: (y, callback) => {
        const line = handlersRef.current.onOpenFile ? cellOffsets(terminal, y - 1) : null;
        if (!line) {
          callback(undefined);
          return;
        }
        const links = findFileLinks(line.text).map((link) => {
          const text = line.text.slice(link.start, link.end);
          return {
            range: {
              start: { x: line.cellAt[link.start] + 1, y },
              end: { x: line.cellAt[link.end - 1] + 1, y },
            },
            text,
            activate: (event: MouseEvent) => {
              if (isOpenGesture(event)) handlersRef.current.onOpenFile?.(link.path, link.line, link.column);
            },
            hover: () => setLinkHint(text),
            leave: () => setLinkHint(''),
          };
        });
        callback(links.length ? links : undefined);
      },
    }));

    // Shell integration and program notices.
    let commandStartedAt = 0;
    let lastPromptMarker: IMarker | undefined;
    on(terminal.parser.registerOscHandler(7, (data) => {
      const path = parseOsc7(data);
      if (path) handlersRef.current.onCwd?.(path);
      return true;
    }));
    on(terminal.parser.registerOscHandler(133, (data) => {
      const mark = parseOsc133(data);
      if (!mark) return true;
      if (mark.kind === 'prompt') {
        const marker = terminal.registerMarker(0);
        if (marker) {
          lastPromptMarker = marker;
          promptMarkersRef.current = [...promptMarkersRef.current.filter((item) => !item.isDisposed), marker].slice(-1000);
        }
        handlersRef.current.onCommandRunning?.(false);
      } else if (mark.kind === 'command') {
        commandStartedAt = Date.now();
        handlersRef.current.onCommandRunning?.(true);
      } else if (mark.kind === 'finished') {
        const marker = lastPromptMarker;
        if (marker && !marker.isDisposed && commandStartedAt) {
          const failed = mark.exitCode !== null && mark.exitCode !== 0;
          const colors = colorsRef.current;
          const decoration = terminal.registerDecoration({
            marker,
            width: 1,
            overviewRulerOptions: colors ? { color: opaque(failed ? colors.markFailure : colors.markSuccess), position: 'left' } : undefined,
          });
          decoration?.onRender((element) => {
            element.classList.add('todex-prompt-mark');
            element.dataset.failed = String(failed);
          });
        }
        if (commandStartedAt) {
          handlersRef.current.onCommandFinished?.({ exitCode: mark.exitCode, durationMs: Date.now() - commandStartedAt });
        }
        commandStartedAt = 0;
        handlersRef.current.onCommandRunning?.(false);
      }
      return true;
    }));
    const notify = (ident: 9 | 777) => (data: string) => {
      const notification = parseTerminalNotification(ident, data);
      if (!notification) return false;
      handlersRef.current.onNotification?.(notification);
      return true;
    };
    // Registered after the progress addon, so they see OSC 9 first and pass
    // OSC 9;4 progress reports on to it.
    on(terminal.parser.registerOscHandler(9, notify(9)));
    on(terminal.parser.registerOscHandler(777, notify(777)));
    on(progressAddon.onChange((progress) => handlersRef.current.onProgress?.(progress)));
    on(terminal.onTitleChange((title) => handlersRef.current.onTitle?.(title)));
    on(terminal.onBell(() => handlersRef.current.onBell?.()));
    on(searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => setFindResult({ index: resultIndex, count: resultCount })));
    on(terminal.onSelectionChange(() => setHasSelection(terminal.hasSelection())));

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const mod = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey && !event.metaKey;
      const key = event.key.toLowerCase();
      const actions = actionsRef.current;
      if (mod && key === 'c') {
        actions.copySelection();
        event.preventDefault();
        return false;
      }
      // Ctrl+C copies a selection; without one it interrupts as usual.
      if (!IS_MAC && event.ctrlKey && !event.shiftKey && !event.altKey && key === 'c' && terminal.hasSelection()) {
        actions.copySelection();
        terminal.clearSelection();
        event.preventDefault();
        return false;
      }
      // The browser turns the paste key into a paste event (handled below).
      if (mod && key === 'v') return false;
      if (mod && key === 'f') {
        actions.openFind();
        event.preventDefault();
        return false;
      }
      if (mod && key === 'k') {
        actions.clearTerminal();
        event.preventDefault();
        return false;
      }
      if (mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        actions.jumpToPrompt(event.key === 'ArrowUp' ? -1 : 1);
        event.preventDefault();
        return false;
      }
      return true;
    });

    const imagesOf = (data: DataTransfer | null) => [...(data?.files ?? [])].filter((file) => isTerminalImageType(file.type));
    // Every paste (keys, menu, middle click) goes through the safety checks.
    // Text wins; with no text, pasted images are uploaded and their paths
    // pasted (an agent CLI then attaches them).
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      const images = text ? [] : imagesOf(event.clipboardData);
      if (images.length) void actionsRef.current.pasteImages(images);
      else actionsRef.current.pasteText(text);
    };
    container.addEventListener('paste', onPaste, true);
    const onDragOver = (event: DragEvent) => {
      if (!handlersRef.current.onPasteImages || !event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event: DragEvent) => {
      const images = imagesOf(event.dataTransfer);
      if (!handlersRef.current.onPasteImages || !images.length) return;
      event.preventDefault();
      event.stopPropagation();
      void actionsRef.current.pasteImages(images);
    };
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('drop', onDrop);

    on(terminal.onData((data) => handlersRef.current.onData(data)));

    let resizeTimer = 0;
    let lastSize = '';
    on(terminal.onResize(({ rows, cols }) => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const size = `${rows}x${cols}`;
        if (size === lastSize) return;
        lastSize = size;
        handlersRef.current.onResize(rows, cols);
      }, RESIZE_THROTTLE_MS);
    }));

    let fitFrame = 0;
    const fit = () => {
      window.cancelAnimationFrame(fitFrame);
      fitFrame = window.requestAnimationFrame(() => {
        if (!isActiveRef.current || container.clientWidth === 0 || container.clientHeight === 0) return;
        fitAddon.fit();
      });
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    fit();

    // Output: what the stream kept, then live updates written once a frame.
    let pending = '';
    let writeFrame = 0;
    let lastActivity = 0;
    const flush = () => {
      writeFrame = 0;
      if (!pending) return;
      terminal.write(pending);
      pending = '';
    };
    // A truncated tail may start mid-sequence; a snapshot replaces it.
    if (!stream.truncated || !handlersRef.current.onRequestSnapshot?.()) {
      terminal.write(stream.snapshot());
    }
    const unsubscribe = stream.subscribe((update) => {
      if (update.kind === 'reset') {
        window.cancelAnimationFrame(writeFrame);
        writeFrame = 0;
        pending = '';
        terminal.reset();
        promptMarkersRef.current = [];
        if (update.data) terminal.write(update.data);
        return;
      }
      pending += update.data;
      if (!writeFrame) writeFrame = window.requestAnimationFrame(flush);
      const now = Date.now();
      if (now - lastActivity > ACTIVITY_THROTTLE_MS) {
        lastActivity = now;
        handlersRef.current.onActivity?.();
      }
    });

    return () => {
      unsubscribe();
      window.cancelAnimationFrame(writeFrame);
      window.cancelAnimationFrame(fitFrame);
      window.clearTimeout(resizeTimer);
      container.removeEventListener('paste', onPaste, true);
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('drop', onDrop);
      resizeObserver.disconnect();
      disposables.forEach((disposable) => disposable.dispose());
      webglRef.current?.dispose();
      webglRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      promptMarkersRef.current = [];
    };
  }, [stream]);

  // The palette follows the app's light/dark switch.
  useEffect(() => {
    const syncTheme = () => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      colorsRef.current = resolveColors(THEME_TOKENS);
      terminal.options.theme = terminalTheme(colorsRef.current);
    };
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = preferences.fontSize;
    terminal.options.fontFamily = terminalFontFamily(preferences.fontFamily);
    terminal.options.cursorStyle = preferences.cursorStyle;
    if (isActiveRef.current) fitAddonRef.current?.fit();
  }, [preferences.cursorStyle, preferences.fontFamily, preferences.fontSize]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = isDisabled;
    }
  }, [isDisabled]);

  // Only visible terminals hold a WebGL context (browsers cap how many a page
  // may have). A lost or unavailable context falls back to the DOM renderer.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (isActive && !webglRef.current && !webglFailedRef.current) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webglFailedRef.current = true;
          webgl.dispose();
          if (webglRef.current === webgl) webglRef.current = null;
        });
        terminal.loadAddon(webgl);
        webglRef.current = webgl;
      } catch {
        webglFailedRef.current = true;
      }
    } else if (!isActive && webglRef.current) {
      webglRef.current.dispose();
      webglRef.current = null;
    }
    if (!isActive) return;
    const animationFrame = window.requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      terminal.refresh(0, terminal.rows - 1);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isActive, stream]);

  useEffect(() => {
    if (findOpen) runSearch(findQuery, 'next', true);
  }, [findOpen, findQuery, runSearch]);

  const shortcut = (key: string) => (IS_MAC ? `⌘${key}` : `Ctrl+Shift+${key}`);
  return (
    <div className="relative h-full min-h-0 w-full">
      <div
        ref={containerRef}
        aria-label={t('xterm.interactive')}
        className="h-full min-h-0 w-full overflow-hidden px-3 py-2"
        role="application"
        title={linkHint ? t('xterm.openLinkHint', { target: linkHint, key: IS_MAC ? '⌘' : 'Ctrl' }) : undefined}
        onContextMenu={(event) => {
          event.preventDefault();
          setHasSelection(Boolean(terminalRef.current?.hasSelection()));
          setMenuPosition({ x: event.clientX, y: event.clientY });
        }}
      />
      {findOpen ? (
        <div className="absolute end-3 top-2 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-xl border border-border-button-default bg-background-primary-default p-1 shadow-sm">
          <Input
            aria-label={t('xterm.find')}
            size="small"
            autoFocus
            value={findQuery}
            onChange={setFindQuery}
            placeholder={t('xterm.find')}
            leadingIcon={RiSearchLine}
            className="w-56 min-w-0 shrink"
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch(findQuery, event.shiftKey ? 'previous' : 'next');
              if (event.key === 'Escape') closeFind();
            }}
          />
          <span className={cx('min-w-12 shrink-0 px-1 text-center text-caption-1-regular', findResult?.count === 0 && findQuery ? 'text-text-error-primary' : 'text-text-tertiary')}>
            {findQuery && findResult ? (findResult.count === 0 ? t('xterm.noMatches') : `${findResult.index + 1}/${findResult.count}`) : ''}
          </span>
          <IconAction size="sm" icon={RiArrowUpSLine} aria-label={t('xterm.findPrevious')} tooltip onClick={() => runSearch(findQuery, 'previous')} />
          <IconAction size="sm" icon={RiArrowDownSLine} aria-label={t('xterm.findNext')} tooltip onClick={() => runSearch(findQuery, 'next')} />
          <IconAction size="sm" icon={RiCloseLine} aria-label={t('xterm.closeFind')} tooltip onClick={closeFind} />
        </div>
      ) : null}
      <ContextMenu position={menuPosition} onClose={() => setMenuPosition(null)}>
        <Menu aria-label={t('xterm.menu')}>
          <MenuItem isDisabled={!hasSelection} trailing={shortcut('C')} onAction={() => { copySelection(); }}>{t('xterm.copy')}</MenuItem>
          <MenuItem isDisabled={isDisabled} trailing={shortcut('V')} onAction={requestPaste}>{t('xterm.paste')}</MenuItem>
          <MenuItem onAction={() => terminalRef.current?.selectAll()}>{t('xterm.selectAll')}</MenuItem>
          <MenuSeparator />
          <MenuItem trailing={shortcut('F')} onAction={openFind}>{t('xterm.find')}</MenuItem>
          <MenuItem trailing={shortcut('K')} onAction={clearTerminal}>{t('xterm.clear')}</MenuItem>
        </Menu>
      </ContextMenu>
      <ConfirmDialog
        isOpen={pendingPaste !== null}
        onOpenChange={(open) => { if (!open) setPendingPaste(null); }}
        title={t('xterm.pasteConfirmTitle')}
        description={t('xterm.pasteConfirmDescription', { count: String((pendingPaste ?? '').split(/\r\n|\r|\n/).length) })}
        confirmLabel={t('xterm.pasteConfirm')}
        cancelLabel={t('xterm.cancel')}
        onConfirm={() => {
          const text = pendingPaste;
          setPendingPaste(null);
          if (text) terminalRef.current?.paste(sanitizePaste(text));
          terminalRef.current?.focus();
        }}
      >
        <pre dir="ltr" className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-background-secondary-default p-3 font-mono text-caption-1-regular text-text-secondary">
          {(pendingPaste ?? '').slice(0, 2000)}
        </pre>
      </ConfirmDialog>
    </div>
  );
}

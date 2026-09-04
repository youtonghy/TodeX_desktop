import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { TerminalOutputEntry } from '../session/helpers';

type Props = {
  entries: TerminalOutputEntry[];
  isActive: boolean;
  isDisabled?: boolean;
  onData: (data: string) => void;
  onResize: (rows: number, cols: number) => void;
};

function errorMessage(entry: TerminalOutputEntry): string {
  const text = entry.text.replace(/\r?\n/g, '\r\n');
  return `\r\n\x1b[31m${text}\x1b[0m\r\n`;
}

function getIsDark(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark';
}

function resolveSurfaceColors(container?: HTMLElement | null, isDark: boolean = getIsDark()) {
  let bg = isDark ? '#1a2a35' : '#e8f2f5';
  let fg = isDark ? '#e2e9ec' : '#1f2d37';

  if (typeof document !== 'undefined') {
    try {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--surface-secondary)';
      probe.style.color = 'var(--surface-secondary-foreground)';
      document.body.appendChild(probe);
      const computed = window.getComputedStyle(probe);
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        if (computed.backgroundColor && computed.backgroundColor !== 'transparent') {
          ctx.fillStyle = computed.backgroundColor;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          bg = `rgb(${r}, ${g}, ${b})`;
        }
        if (computed.color && computed.color !== 'transparent') {
          ctx.fillStyle = computed.color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          fg = `rgb(${r}, ${g}, ${b})`;
        }
      }
      document.body.removeChild(probe);
    } catch {
      // fallback to precalculated colors
    }
  }

  return { bg, fg };
}

function getTerminalTheme(container?: HTMLElement | null) {
  const isDark = getIsDark();
  const { bg, fg } = resolveSurfaceColors(container, isDark);

  if (isDark) {
    return {
      background: bg,
      foreground: fg,
      cursor: '#e7eaee',
      cursorAccent: bg,
      selectionBackground: '#79c0ff44',
      black: bg,
      red: '#ff7b72',
      green: '#7ee787',
      yellow: '#e3b341',
      blue: '#79c0ff',
      magenta: '#d2a8ff',
      cyan: '#a5d6ff',
      white: '#d8dee9',
      brightBlack: '#8b989e',
      brightRed: '#ffa198',
      brightGreen: '#aff5b4',
      brightYellow: '#f2cc60',
      brightBlue: '#a5d6ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#b6e3ff',
      brightWhite: '#f0f6fc',
    };
  }

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: '#0969da33',
    black: fg,
    red: '#cf222e',
    green: '#116329',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: bg,
    brightBlack: '#5f6e7a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#ffffff',
  };
}

export function XtermTerminal({ entries, isActive, isDisabled = false, onData, onResize }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writtenEntryIdsRef = useRef(new Set<string>());
  const lastEntryIdRef = useRef('');
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const isActiveRef = useRef(isActive);

  onDataRef.current = onData;
  onResizeRef.current = onResize;
  isActiveRef.current = isActive;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      disableStdin: isDisabled,
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: getTerminalTheme(container),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let animationFrame = 0;
    const fit = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (!isActiveRef.current || container.clientWidth === 0 || container.clientHeight === 0) return;
        fitAddon.fit();
      });
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    const dataDisposable = terminal.onData((data) => onDataRef.current(data));
    const resizeDisposable = terminal.onResize(({ rows, cols }) => onResizeRef.current(rows, cols));
    fit();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      writtenEntryIdsRef.current.clear();
      lastEntryIdRef.current = '';
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const syncTheme = () => {
      terminal.options.theme = getTerminalTheme(containerRef.current);
    };
    syncTheme();

    const observer = new MutationObserver(() => syncTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = isDisabled;
    }
  }, [isDisabled]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !isActive) return;
    const animationFrame = window.requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      terminal.refresh(0, terminal.rows - 1);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isActive]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const previousLastEntryId = lastEntryIdRef.current;
    const currentEntryIds = new Set(entries.map((entry) => entry.id));
    if (previousLastEntryId && !currentEntryIds.has(previousLastEntryId)) {
      terminal.reset();
      writtenEntryIdsRef.current.clear();
    }

    for (const entry of entries) {
      if (writtenEntryIdsRef.current.has(entry.id)) continue;
      writtenEntryIdsRef.current.add(entry.id);
      if (entry.kind === 'input' || entry.kind === 'system') continue;
      terminal.write(entry.kind === 'error' ? errorMessage(entry) : entry.text);
    }
    for (const entryId of writtenEntryIdsRef.current) {
      if (!currentEntryIds.has(entryId)) writtenEntryIdsRef.current.delete(entryId);
    }
    lastEntryIdRef.current = entries.at(-1)?.id ?? '';
  }, [entries]);

  return (
    <div
      ref={containerRef}
      aria-label="交互式终端"
      className="h-full min-h-0 w-full overflow-hidden px-3 py-2"
      role="application"
    />
  );
}

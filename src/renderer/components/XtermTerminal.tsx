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
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'block',
      disableStdin: isDisabled,
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: {
        background: '#111418',
        foreground: '#d8dee9',
        cursor: '#e7eaee',
        cursorAccent: '#111418',
        selectionBackground: '#3f566e99',
        black: '#111418',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#d2a8ff',
        blue: '#79c0ff',
        magenta: '#d2a8ff',
        cyan: '#a5d6ff',
        white: '#d8dee9',
        brightBlack: '#8b949e',
        brightRed: '#ffa198',
        brightGreen: '#aff5b4',
        brightYellow: '#e3b341',
        brightBlue: '#a5d6ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#b6e3ff',
        brightWhite: '#f0f6fc',
      },
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

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { KeyboardEvent } from 'react';
import { cx } from '@/utils/cx';
import { useT } from '../i18n';
import {
  composerToken,
  composerTokenKindFromLabel,
  composerTokenPattern,
  type ComposerTokenRef,
} from '../session/helpers';

type TokenKind = ComposerTokenRef['kind'];

/** Icon paths from Remixicon, the icon set used across the app (MIT). */
const TOKEN_ICON_PATHS: Record<TokenKind, string> = {
  reference: 'M4.58341 17.3211C3.55316 16.2274 3 15 3 13.0103C3 9.51086 5.45651 6.37366 9.03059 4.82318L9.92328 6.20079C6.58804 8.00539 5.93618 10.346 5.67564 11.822C6.21263 11.5443 6.91558 11.4466 7.60471 11.5105C9.40908 11.6778 10.8312 13.159 10.8312 15C10.8312 16.933 9.26416 18.5 7.33116 18.5C6.2581 18.5 5.23196 18.0095 4.58341 17.3211ZM14.5834 17.3211C13.5532 16.2274 13 15 13 13.0103C13 9.51086 15.4565 6.37366 19.0306 4.82318L19.9233 6.20079C16.588 8.00539 15.9362 10.346 15.6756 11.822C16.2126 11.5443 16.9156 11.4466 17.6047 11.5105C19.4091 11.6778 20.8312 13.159 20.8312 15C20.8312 16.933 19.2642 18.5 17.3312 18.5C16.2581 18.5 15.232 18.0095 14.5834 17.3211Z',
  file: 'M21 8V20.9932C21 21.5501 20.5552 22 20.0066 22H3.9934C3.44495 22 3 21.556 3 21.0082V2.9918C3 2.45531 3.4487 2 4.00221 2H14.9968L21 8ZM19 9H14V4H5V20H19V9ZM8 7H11V9H8V7ZM8 11H16V13H8V11ZM8 15H16V17H8V15Z',
  text: 'M13 6V21H11V6H5V4H19V6H13Z',
  image: 'M2.9918 21C2.44405 21 2 20.5551 2 20.0066V3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918ZM20 15V5H4V19L14 9L20 15ZM20 17.8284L14 11.8284L6.82843 19H20V17.8284ZM8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7C9.10457 7 10 7.89543 10 9C10 10.1046 9.10457 11 8 11Z',
};

/** Remixicon `loader-4-line` and `error-warning-line`, shown while an
 * attachment uploads and after its upload failed. */
const UPLOADING_ICON_PATH = 'M18.364 5.63604L16.9497 7.05025C15.683 5.7835 13.933 5 12 5C8.13401 5 5 8.13401 5 12C5 15.866 8.13401 19 12 19C15.866 19 19 15.866 19 12H21C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.4853 3 16.7353 4.00736 18.364 5.63604Z';
const FAILED_ICON_PATH = 'M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 15H13V17H11V15ZM11 7H13V13H11V7Z';

const SVG_NS = 'http://www.w3.org/2000/svg';

/* Capsules are built as DOM nodes inside the contentEditable, so their
   BoardUI styling lives in these class strings. `composer-ref*` stay as the
   hooks the editor's event handlers look up. A quote is an excerpt of the
   conversation, so it keeps the accent tint. */
const CAPSULE_CLASS = 'inline-flex max-w-80 items-baseline gap-1 mx-px rounded-full px-2 py-px align-baseline text-body-medium select-none data-[state=uploading]:text-text-tertiary data-[state=failed]:bg-background-tertiary-error data-[state=failed]:text-text-error-primary';
const CAPSULE_TONE: Record<TokenKind, string> = {
  reference: 'bg-badge-new-background text-badge-new-text',
  file: 'bg-background-tertiary-default text-text-primary',
  text: 'bg-background-tertiary-default text-text-primary',
  image: 'bg-background-tertiary-default text-text-primary',
};
const CAPSULE_ICON_TONE: Record<TokenKind, string> = {
  reference: 'opacity-80',
  file: 'text-text-accent',
  text: 'text-text-accent',
  image: 'text-text-accent',
};
const STATE_ICON_TONE = 'text-current';
const UPLOADING_ICON_MOTION = 'motion-safe:animate-spin';

export type ComposerTokenState = 'uploading' | 'failed';

/** Shows a capsule's upload state: a spinning icon while it uploads, an
 * error tint and icon after a failed upload. */
function applyTokenState(el: HTMLElement, state: ComposerTokenState | undefined, title: string | undefined): void {
  const kind = el.dataset.kind as TokenKind | undefined;
  if (!kind) return;
  if ((el.dataset.state ?? '') === (state ?? '') && el.title === (title ?? el.dataset.ref ?? '')) return;
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
  el.setAttribute('aria-busy', state === 'uploading' ? 'true' : 'false');
  el.title = title ?? el.dataset.ref ?? '';
  const icon = el.querySelector<SVGElement>('.composer-ref__icon');
  const path = icon?.querySelector('path');
  if (!icon || !path) return;
  path.setAttribute('d', state === 'uploading' ? UPLOADING_ICON_PATH : state === 'failed' ? FAILED_ICON_PATH : TOKEN_ICON_PATHS[kind]);
  icon.setAttribute('class', cx(
    'composer-ref__icon size-[0.9em] flex-none self-center',
    state ? STATE_ICON_TONE : CAPSULE_ICON_TONE[kind],
    state === 'uploading' && UPLOADING_ICON_MOTION,
  ));
}

function makeIcon(kind: TokenKind): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', cx('composer-ref__icon size-[0.9em] flex-none self-center', CAPSULE_ICON_TONE[kind]));
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', TOKEN_ICON_PATHS[kind]);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

function isBlock(node: Node): boolean {
  return node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P');
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (node instanceof HTMLElement) {
    if (node.dataset.token !== undefined) return node.dataset.token;
    if (node.tagName === 'BR') {
      return node.parentElement && node.parentElement.childNodes.length === 1 ? '' : '\n';
    }
  }
  let out = '';
  let first = true;
  node.childNodes.forEach((child) => {
    if (isBlock(child) && !first) out += '\n';
    out += serializeInline(child);
    first = false;
  });
  return out;
}

function serialize(root: HTMLElement): string {
  return serializeInline(root);
}

function makeCapsule(kind: TokenKind, name: string, label: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cx('composer-ref', `composer-ref--${kind}`, CAPSULE_CLASS, CAPSULE_TONE[kind]);
  el.contentEditable = 'false';
  el.dataset.ref = name;
  el.dataset.kind = kind;
  el.dataset.token = composerToken(kind, name);
  el.title = name;
  const text = document.createElement('span');
  text.className = 'composer-ref__label truncate';
  text.textContent = label || name;
  const close = document.createElement('span');
  close.className = 'composer-ref__remove ms-0.5 cursor-pointer opacity-55 transition-opacity duration-150 hover:opacity-100';
  close.setAttribute('aria-hidden', 'true');
  close.textContent = '×';
  el.append(makeIcon(kind), text, close);
  return el;
}

function appendInline(
  parent: ParentNode,
  line: string,
  resolve: (kind: TokenKind, name: string) => string | undefined,
): void {
  let last = 0;
  for (const match of line.matchAll(composerTokenPattern())) {
    const kind = composerTokenKindFromLabel(match[1]);
    if (!kind) continue;
    if (match.index > last) parent.append(document.createTextNode(line.slice(last, match.index)));
    parent.append(makeCapsule(kind, match[2], resolve(kind, match[2]) ?? match[2]));
    last = match.index + match[0].length;
  }
  if (last < line.length) parent.append(document.createTextNode(line.slice(last)));
  if (parent instanceof HTMLDivElement && parent.childNodes.length === 0) {
    parent.append(document.createElement('br'));
  }
}

function buildChildren(
  root: HTMLElement,
  text: string,
  resolve: (kind: TokenKind, name: string) => string | undefined,
): void {
  const fragment = document.createDocumentFragment();
  for (const line of text.split('\n')) {
    const div = document.createElement('div');
    appendInline(div, line, resolve);
    fragment.append(div);
  }
  root.replaceChildren(fragment);
}

function lengthOfRange(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return serializeInline(range.cloneContents()).length;
}

function isOverDirectText(root: HTMLElement, x: number, y: number): boolean {
  const range = document.createRange();
  return Array.from(root.childNodes).some((node) => {
    if (node.nodeType !== Node.TEXT_NODE) return false;
    range.selectNodeContents(node);
    return Array.from(range.getClientRects()).some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  });
}

type TextPos = { node: Node; offset: number };

function locate(node: Node, remaining: number): TextPos {
  if (node.nodeType === Node.TEXT_NODE) return { node, offset: remaining };
  const children = Array.from(node.childNodes);
  let first = true;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (isBlock(child) && !first) {
      if (remaining === 0) return { node, offset: i };
      remaining -= 1;
    }
    first = false;
    const length = serializeInline(child).length;
    if (remaining <= length) {
      if (child.nodeType === Node.TEXT_NODE) return { node: child, offset: remaining };
      if (child instanceof HTMLElement && child.dataset.token !== undefined) {
        return { node, offset: remaining === 0 ? i : i + 1 };
      }
      return locate(child, remaining);
    }
    remaining -= length;
  }
  return { node, offset: children.length };
}

export type ReferenceComposerSelection = { start: number; end: number };
export type ReferenceComposerHandle = { focus: (offset?: number) => void };

export const ReferenceComposer = forwardRef<ReferenceComposerHandle, {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onSelectionChange?: (selection: ReferenceComposerSelection) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  placeholder?: string;
  isDisabled?: boolean;
  /** Capsule label override, e.g. the first line of a quoted excerpt. */
  resolveTokenLabel?: (kind: TokenKind, name: string) => string | undefined;
  onTokenClick?: (kind: TokenKind, name: string) => void;
  /** Upload state and tooltip per capsule token. */
  tokenStates?: Readonly<Record<string, { state: ComposerTokenState; title?: string }>>;
}>(function ReferenceComposer({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  onSelectionChange,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
  isDisabled,
  resolveTokenLabel,
  onTokenClick,
  tokenStates,
}, forwardedRef) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const forceRebuildRef = useRef(false);
  const pendingCaretRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const resolveRef = useRef(resolveTokenLabel);
  resolveRef.current = resolveTokenLabel;
  const clickRef = useRef(onTokenClick);
  clickRef.current = onTokenClick;

  const readSelection = useCallback((): ReferenceComposerSelection | null => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return null;
    if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
    const range = selection.getRangeAt(0);
    const start = lengthOfRange(root, range.startContainer, range.startOffset);
    const end = range.collapsed ? start : lengthOfRange(root, range.endContainer, range.endOffset);
    return { start, end };
  }, []);

  const applyCaret = useCallback((target: ReferenceComposerSelection | number) => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection) return;
    const sel = typeof target === 'number' ? { start: target, end: target } : target;
    const start = locate(root, sel.start);
    const end = sel.end === sel.start ? start : locate(root, sel.end);
    selection.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
  }, []);

  const updateEmpty = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (serialize(root) === '') root.setAttribute('data-empty', 'true');
    else root.removeAttribute('data-empty');
  }, []);

  const emitChange = useCallback(() => {
    // User edits supersede any programmatic caret still waiting for a rebuild.
    pendingCaretRef.current = null;
    const root = rootRef.current;
    if (!root) return;
    const text = serialize(root);
    if (!forceRebuildRef.current) renderedRef.current = text;
    forceRebuildRef.current = false;
    updateEmpty();
    onChange(text);
  }, [onChange, updateEmpty]);

  const lastSelectionRef = useRef<ReferenceComposerSelection | null>(null);

  // Rebuild only when the text came from outside our own input handling.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || composingRef.current) return;
    if (renderedRef.current === value) {
      if (pendingCaretRef.current != null) {
        applyCaret(pendingCaretRef.current);
        pendingCaretRef.current = null;
      }
      return;
    }
    const previous = document.activeElement === root ? readSelection() : null;
    buildChildren(root, value, (kind, name) => resolveRef.current?.(kind, name));
    renderedRef.current = value;
    updateEmpty();
    if (pendingCaretRef.current != null) {
      applyCaret(pendingCaretRef.current);
      pendingCaretRef.current = null;
    } else if (previous) {
      const length = value.length;
      applyCaret({ start: Math.min(previous.start, length), end: Math.min(previous.end, length) });
    }
  }, [value, applyCaret, readSelection, updateEmpty]);

  // After any rebuild above, so fresh capsules pick up their state too.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('.composer-ref').forEach((el) => {
      const entry = el.dataset.token ? tokenStates?.[el.dataset.token] : undefined;
      applyTokenState(el, entry?.state, entry?.title);
    });
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onSelectionChange) return;
    const handler = () => {
      const sel = readSelection();
      const last = lastSelectionRef.current;
      if (sel && (!last || last.start !== sel.start || last.end !== sel.end)) {
        lastSelectionRef.current = sel;
        onSelectionChange(sel);
      }
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [onSelectionChange, readSelection]);

  useImperativeHandle(forwardedRef, () => ({
    focus(offset?: number) {
      if (offset != null) pendingCaretRef.current = offset;
      rootRef.current?.focus();
      if (offset != null && renderedRef.current === valueRef.current && rootRef.current) {
        applyCaret(offset);
        // Keep pendingCaretRef set: when `value` was updated upstream but the
        // rebuild effect has not run yet, it must re-apply this caret to the
        // new tree instead of the stale pre-rebuild position.
      }
    },
  }), [applyCaret]);

  return (
    <div
      ref={rootRef}
      role="textbox"
      aria-multiline="true"
      aria-label={t('composer.messageInput')}
      aria-disabled={isDisabled || undefined}
      data-placeholder={placeholder}
      className={cx(
        'composer-editor relative max-h-60 min-h-10 cursor-text overflow-y-auto wrap-break-word outline-none',
        'text-body-regular text-text-primary caret-accent-500',
        isDisabled && 'cursor-not-allowed',
      )}
      contentEditable={!isDisabled}
      suppressContentEditableWarning
      onInput={emitChange}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        const capsule = target.closest<HTMLElement>('.composer-ref');
        if (target.closest('.composer-ref__remove') && capsule) {
          event.preventDefault();
          capsule.remove();
          emitChange();
          return;
        }
        const kind = capsule?.dataset.kind;
        if (capsule && capsule.dataset.ref != null
          && (kind === 'reference' || kind === 'file' || kind === 'text' || kind === 'image')) {
          clickRef.current?.(kind, capsule.dataset.ref);
          return;
        }
        if (target === rootRef.current && !isOverDirectText(rootRef.current, event.clientX, event.clientY)) {
          // Keep clicks on the padding area inside the editor focusable. Text
          // typed after select-all + delete sits directly in the root, so a
          // click on it also targets the root and must keep native caret placement.
          event.preventDefault();
          rootRef.current.focus();
          applyCaret(valueRef.current.length);
        }
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Enter' && !event.shiftKey && !composingRef.current && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSubmit?.();
        }
      }}
      onCopy={(event) => {
        const selection = window.getSelection();
        const root = rootRef.current;
        if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', serializeInline(range.cloneContents()));
      }}
      onCut={(event) => {
        const selection = window.getSelection();
        const root = rootRef.current;
        if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', serializeInline(range.cloneContents()));
        range.deleteContents();
        emitChange();
      }}
      onPaste={(event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return;
        event.preventDefault();
        // A pasted capsule token should render as a capsule again.
        forceRebuildRef.current = composerTokenPattern().test(text);
        if (typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)) {
          return;
        }
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.setStartAfter(range.endContainer);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        emitChange();
      }}
      onCompositionStart={() => {
        composingRef.current = true;
        onCompositionStart?.();
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        onCompositionEnd?.();
        // The final composed text arrives without another input event in some browsers.
        emitChange();
        const root = rootRef.current;
        if (root && renderedRef.current !== valueRef.current) {
          buildChildren(root, valueRef.current, (kind, name) => resolveRef.current?.(kind, name));
          renderedRef.current = valueRef.current;
          updateEmpty();
        }
      }}
      onBlur={() => {
        if (composingRef.current) composingRef.current = false;
      }}
    />
  );
});

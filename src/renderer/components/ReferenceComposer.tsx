import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { KeyboardEvent } from 'react';
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
  image: 'M2.9918 21C2.44405 21 2 20.5551 2 20.0066V3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918ZM20 15V5H4V19L14 9L20 15ZM20 17.8284L14 11.8284L6.82843 19H20V17.8284ZM8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7C9.10457 7 10 7.89543 10 9C10 10.1046 9.10457 11 8 11Z',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeIcon(kind: TokenKind): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'composer-ref__icon');
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
  el.className = `composer-ref composer-ref--${kind}`;
  el.contentEditable = 'false';
  el.dataset.ref = name;
  el.dataset.kind = kind;
  el.dataset.token = composerToken(kind, name);
  el.title = name;
  const text = document.createElement('span');
  text.className = 'composer-ref__label';
  text.textContent = label || name;
  const close = document.createElement('span');
  close.className = 'composer-ref__remove';
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
      data-slot="prompt-input-textarea"
      data-placeholder={placeholder}
      className="composer-editor prompt-input__textarea textarea"
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
          && (kind === 'reference' || kind === 'file' || kind === 'image')) {
          clickRef.current?.(kind, capsule.dataset.ref);
          return;
        }
        if (target === rootRef.current) {
          // Keep clicks on the padding area inside the editor focusable.
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

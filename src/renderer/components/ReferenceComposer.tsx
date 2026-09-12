import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { KeyboardEvent } from 'react';

const TOKEN_PATTERN = /\[引用:([^\]\n]+)\]/g;

function isBlock(node: Node): boolean {
  return node instanceof HTMLElement && (node.tagName === 'DIV' || node.tagName === 'P');
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (node instanceof HTMLElement) {
    if (node.dataset.ref !== undefined) return `[引用:${node.dataset.ref}]`;
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

function makeCapsule(name: string, label: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'composer-ref';
  el.contentEditable = 'false';
  el.dataset.ref = name;
  el.title = name;
  const text = document.createElement('span');
  text.className = 'composer-ref__label';
  text.textContent = label || name;
  const close = document.createElement('span');
  close.className = 'composer-ref__remove';
  close.setAttribute('aria-hidden', 'true');
  close.textContent = '×';
  el.append(text, close);
  return el;
}

function appendInline(parent: ParentNode, line: string, resolve: (name: string) => string | undefined): void {
  let last = 0;
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    if (match.index > last) parent.append(document.createTextNode(line.slice(last, match.index)));
    parent.append(makeCapsule(match[1], resolve(match[1]) ?? match[1]));
    last = match.index + match[0].length;
  }
  if (last < line.length) parent.append(document.createTextNode(line.slice(last)));
  if (parent instanceof HTMLDivElement && parent.childNodes.length === 0) {
    parent.append(document.createElement('br'));
  }
}

function buildChildren(root: HTMLElement, text: string, resolve: (name: string) => string | undefined): void {
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
      if (child instanceof HTMLElement && child.dataset.ref !== undefined) {
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
  resolveReference?: (name: string) => string | undefined;
  onReferenceClick?: (name: string) => void;
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
  resolveReference,
  onReferenceClick,
}, forwardedRef) {
  const rootRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const forceRebuildRef = useRef(false);
  const pendingCaretRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const resolveRef = useRef(resolveReference);
  resolveRef.current = resolveReference;
  const clickRef = useRef(onReferenceClick);
  clickRef.current = onReferenceClick;

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
    buildChildren(root, value, (name) => resolveRef.current?.(name));
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
      aria-label="消息输入"
      aria-disabled={isDisabled || undefined}
      data-slot="prompt-input-textarea"
      data-placeholder={placeholder}
      className="composer-editor prompt-input__textarea textarea"
      contentEditable={!isDisabled}
      suppressContentEditableWarning
      onInput={emitChange}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        const capsule = target.closest('.composer-ref');
        if (target.closest('.composer-ref__remove') && capsule instanceof HTMLElement) {
          event.preventDefault();
          capsule.remove();
          emitChange();
          return;
        }
        if (capsule instanceof HTMLElement && capsule.dataset.ref != null) {
          clickRef.current?.(capsule.dataset.ref);
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
        // A pasted [引用:name] token should render as a capsule again.
        forceRebuildRef.current = /\[引用:[^\]\n]+\]/.test(text);
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
          buildChildren(root, valueRef.current, (name) => resolveRef.current?.(name));
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

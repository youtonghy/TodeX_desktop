export type TextSelectionInfo = {
  text: string;
  left: number;
  top: number;
};

export type TextLineRange = {
  lineStart: number;
  lineEnd: number;
};

/** Read the current DOM selection if it lives inside the container. */
export function selectionInside(container: HTMLElement): TextSelectionInfo | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const rect = typeof range.getBoundingClientRect === 'function'
    ? range.getBoundingClientRect()
    : ({ left: 0, bottom: 0, width: 0 } as DOMRect);
  return { text, left: rect.left + rect.width / 2, top: rect.bottom + 6 };
}

/**
 * Map the selection's start offset to character offsets within `element`.
 * Only trustworthy when `element.textContent` equals the source text.
 */
export function selectionStartOffset(element: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  return prefix.toString().length;
}

export function lineRangeForOffsets(text: string, start: number, end: number): TextLineRange {
  const lineStart = text.slice(0, Math.max(0, start)).split('\n').length;
  const lineEnd = text.slice(0, Math.max(start, end)).split('\n').length;
  return { lineStart, lineEnd };
}

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ComposerPanel,
  type ComposerAttachment,
  type ComposerPanelProps,
} from "@/components/application/composer-panel/composer-panel";

/**
 * Figma source: Board UI → "new composer with attachments" (node 4430:12544).
 *
 * The Composer Panel with its attachment queue wired up. Files arrive
 * through `attachments`; any of them carrying `progress: 0` is queued and
 * landed one after another: the tile scales in, the accent ring draws
 * around it, the ring closes and fades while the dismiss appears, then the
 * next file starts. The upload itself is simulated so the block stays
 * backend-agnostic. For real uploads, feed your own progress values to the
 * core `ComposerPanel` instead.
 *
 * The parent owns the list: dismissals come back through
 * `onAttachmentsChange`, and files that leave `attachments` leave the strip.
 */

export interface ComposerWithAttachmentsProps
  extends Omit<ComposerPanelProps, "attachments" | "onRemoveAttachment"> {
  /** Files to show. `progress: 0` queues one for the simulated upload. */
  attachments: ComposerAttachment[];
  /** How long one simulated upload takes, in milliseconds. */
  uploadDuration?: number;
  /** Pause before a queued file starts drawing its ring, in milliseconds. */
  uploadGap?: number;
  /** The list after a dismiss. */
  onAttachmentsChange?: (attachments: ComposerAttachment[]) => void;
  onUploadComplete?: (attachment: ComposerAttachment) => void;
  /** Fires once every queued file has landed. */
  onAllUploaded?: () => void;
}

const TICK_MS = 50;

/* Anything with a progress value, the closed ring at 100 included, is still
 * the queue's business: the next file starts only once this one is cleared. */
const inFlight = (attachment: ComposerAttachment) => attachment.progress !== undefined;

/** Keep the parent's order, keep our progress for files we already know. */
function reconcile(prev: ComposerAttachment[], next: ComposerAttachment[]) {
  const known = new Map(prev.map((attachment) => [attachment.id, attachment]));
  return next.map((attachment) => known.get(attachment.id) ?? { ...attachment });
}

export function ComposerWithAttachments({
  attachments,
  uploadDuration = 1100,
  uploadGap = 240,
  onAttachmentsChange,
  onUploadComplete,
  onAllUploaded,
  ...panelProps
}: ComposerWithAttachmentsProps) {
  const [items, setItems] = useState(() => reconcile([], attachments));
  const [synced, setSynced] = useState(attachments);
  if (synced !== attachments) {
    setSynced(attachments);
    setItems(reconcile(items, attachments));
  }

  const itemsRef = useRef(items);
  const completeRef = useRef(onUploadComplete);
  const allUploadedRef = useRef(onAllUploaded);
  useEffect(() => {
    itemsRef.current = items;
    completeRef.current = onUploadComplete;
    allUploadedRef.current = onAllUploaded;
  });

  // The first file with a progress value is the one in flight; the rest of
  // the queue waits out of sight until it is their turn.
  const active = items.find(inFlight) ?? null;
  const activeId = active?.id ?? null;
  const hadActive = useRef(false);

  useEffect(() => {
    if (activeId === null) {
      if (hadActive.current) {
        hadActive.current = false;
        allUploadedRef.current?.();
      }
      return;
    }
    hadActive.current = true;

    const id = activeId;
    const patch = (progress: number | undefined) =>
      setItems((prev) =>
        prev.map((attachment) => (attachment.id === id ? { ...attachment, progress } : attachment)),
      );

    let value = itemsRef.current.find((attachment) => attachment.id === id)?.progress ?? 0;
    const step = 100 / Math.max(1, uploadDuration / TICK_MS);
    let timer = 0;
    const tick = () => {
      // Uneven steps so the ring reads as a transfer rather than a timer.
      value = Math.min(100, value + step * (0.55 + Math.random() * 0.9));
      patch(Math.round(value));
      if (value < 100) {
        timer = window.setTimeout(tick, TICK_MS);
        return;
      }
      // Let the closed ring be seen before it fades and the dismiss appears.
      timer = window.setTimeout(() => {
        patch(undefined);
        const landed = itemsRef.current.find((attachment) => attachment.id === id);
        if (landed) completeRef.current?.({ ...landed, progress: undefined });
      }, 150);
    };
    timer = window.setTimeout(tick, uploadGap);
    return () => window.clearTimeout(timer);
  }, [activeId, uploadDuration, uploadGap]);

  const remove = (id: string) => {
    const next = itemsRef.current.filter((attachment) => attachment.id !== id);
    setItems(next);
    onAttachmentsChange?.(next);
  };

  const visible = items.filter((attachment) => !inFlight(attachment) || attachment.id === activeId);

  return <ComposerPanel {...panelProps} attachments={visible} onRemoveAttachment={remove} />;
}

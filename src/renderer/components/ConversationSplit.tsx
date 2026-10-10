import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Resizable } from '@heroui-pro/react/resizable';
import type { PanelImperativeHandle } from '@heroui-pro/react/resizable';

/** Width of the conversation rail left behind when the conversation collapses. */
export const CHAT_RAIL_SIZE = '3rem';

type Props = {
  autoSaveId: string;
  /** Navbar + conversation, shown while the conversation is expanded. */
  chat: ReactNode;
  /** Icon rail shown in place of the conversation while it is collapsed. */
  rail: ReactNode;
  aside: ReactNode;
  asideOpen: boolean;
  onAsideOpenChange: (open: boolean) => void;
  chatCollapsed: boolean;
  onChatCollapsedChange: (collapsed: boolean) => void;
};

/**
 * Conversation beside the right panel. AppLayout's own aside caps the main
 * column at 30% and the aside at a fixed max, so the split lives here: the
 * right panel has no max size, and dragging it past the conversation's minimum
 * collapses the conversation to a rail instead of stopping the handle.
 */
export function ConversationSplit({ autoSaveId, chat, rail, aside, asideOpen, onAsideOpenChange, chatCollapsed, onChatCollapsedChange }: Props) {
  const chatRef = useRef<PanelImperativeHandle>(null);
  const asideRef = useRef<PanelImperativeHandle>(null);
  // Panel callbacks also fire for the syncs below; only report user drags.
  const state = useRef({ asideOpen, chatCollapsed });
  state.current = { asideOpen, chatCollapsed };
  const reportAside = (open: boolean) => { if (open !== state.current.asideOpen) onAsideOpenChange(open); };
  const reportChat = (collapsed: boolean) => { if (collapsed !== state.current.chatCollapsed) onChatCollapsedChange(collapsed); };

  useEffect(() => {
    const sync = () => {
      // Without the right panel there is nothing to give the space to.
      syncCollapsed(chatRef.current, asideOpen && chatCollapsed);
      syncCollapsed(asideRef.current, !asideOpen);
    };
    sync();
    // On mount the group registers panel constraints after this effect.
    const frame = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(frame);
  }, [asideOpen, chatCollapsed]);

  return (
    <Resizable autoSaveId={autoSaveId} className="h-full min-h-0">
      <Resizable.Panel
        id="app-layout-main"
        className="min-w-0"
        collapsible
        collapsedSize={CHAT_RAIL_SIZE}
        minSize="360px"
        handleRef={chatRef}
        onCollapse={() => reportChat(true)}
        onExpand={() => reportChat(false)}
      >
        {chatCollapsed && asideOpen ? rail : chat}
      </Resizable.Panel>
      <Resizable.Handle />
      <Resizable.Panel
        id="app-layout-aside"
        className="min-w-0"
        collapsible
        collapsedSize={0}
        defaultSize="420px"
        minSize="320px"
        groupResizeBehavior="preserve-pixel-size"
        handleRef={asideRef}
        onCollapse={() => reportAside(false)}
        onExpand={() => reportAside(true)}
      >
        {aside}
      </Resizable.Panel>
    </Resizable>
  );
}

function syncCollapsed(panel: PanelImperativeHandle | null, collapsed: boolean) {
  if (!panel) return;
  let current: boolean;
  try {
    current = panel.isCollapsed();
  } catch (error) {
    // The group registers panel constraints after the first layout pass.
    if (error instanceof Error && error.message.startsWith('Panel constraints not found')) return;
    throw error;
  }
  if (collapsed && !current) panel.collapse();
  else if (!collapsed && current) panel.expand();
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

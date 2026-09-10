import { canonicalConversationEventType, type ConversationEvent } from '@todex/protocol/v2';
import type { ConversationRuntime, ExtensionEditorRequest, ExtensionNotice } from '@todex/protocol/conversationRuntime';

/** Journal replay only rebuilds state. One-shot effects need explicit live delivery. */
export class PiExtensionEffects {
  private live = new Set<string>();
  private consumed = new Set<string>();
  private key(event: ConversationEvent) { return `${event.conversationId}:${event.eventId}`; }
  markLive(event: ConversationEvent) {
    if (canonicalConversationEventType(event) !== 'extension.ui') return;
    const key = this.key(event);
    if (!this.consumed.has(key)) this.live.add(key);
    if (this.live.size > 4096) this.live.delete(this.live.values().next().value!);
  }
  consume(event: ConversationEvent, state: ConversationRuntime):
    | { kind: 'notice'; notice: ExtensionNotice } | { kind: 'editor'; request: ExtensionEditorRequest } | undefined {
    const key = this.key(event);
    if (!this.live.delete(key) || this.consumed.has(key)) return;
    this.consumed.add(key);
    if (this.consumed.size > 8192) this.consumed.delete(this.consumed.values().next().value!);
    const ui = state.extensionUi;
    if (!ui.runtimeId || state.providerRuntime?.status === 'stopped') return;
    const request = ui.editorRequest;
    if (request?.eventId === event.eventId && request.runtimeId === ui.runtimeId) return { kind: 'editor', request };
    const notice = ui.notices.find(item => item.eventId === event.eventId && item.runtimeId === ui.runtimeId);
    if (notice) return { kind: 'notice', notice };
  }
  reset() { this.live.clear(); this.consumed.clear(); }
}

export const canApplyPluginDraft = (draft: string) => draft.length === 0;

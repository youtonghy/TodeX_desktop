import { createContext, useContext } from 'react';

export type PromptStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type ConversationPromptInputContextValue = {
  value: string;
  status: PromptStatus;
  isDisabled: boolean;
  /** Submits through the composer's submission guard. */
  submit: () => void;
  stop?: () => void;
  setValue: (value: string) => void;
};

export const ConversationPromptInputContext = createContext<ConversationPromptInputContextValue | null>(null);

/** The composer state for controls inside `ConversationPromptInput` (send / stop buttons, fields). */
export function useConversationPromptInput() {
  return useContext(ConversationPromptInputContext);
}

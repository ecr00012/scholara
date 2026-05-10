import type { ChatMessage, ToolCall } from '../../../../agent/types';
import type { ThreadRow } from '../../../../db/types';

export type ChatPhase = 'idle' | 'thinking' | 'streaming' | 'tool';

export type UiMessage = {
  id: number | string;
  live?: boolean;
} & (
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; text: string }
);

export type ChatMessageForRender = ChatMessage; // re-export for prop typing if needed

export interface AgentSessionState {
  thread: ThreadRow | null;
  messages: UiMessage[];
  phase: ChatPhase;
  error: string | null;
}

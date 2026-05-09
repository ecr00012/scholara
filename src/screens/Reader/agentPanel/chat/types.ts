import type { AnthropicMessage, ContentBlock } from '../../../../agent/types';
import type { ThreadRow } from '../../../../db/types';

export type ChatPhase = 'idle' | 'thinking' | 'streaming' | 'tool';

export interface UiMessage {
  id: number | 'live';
  role: 'user' | 'assistant';
  content: ContentBlock[];
  /** True for the in-flight assistant message currently streaming. */
  live?: boolean;
}

export interface AgentSessionState {
  thread: ThreadRow | null;
  messages: UiMessage[];
  phase: ChatPhase;
  error: string | null;
}

export type { AnthropicMessage, ContentBlock };

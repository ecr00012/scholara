import type { ThreadRow, ThreadSpoilerMode } from '../../db/types';
import type {
  ChatPhase,
  UiMessage,
} from '../../screens/Reader/agentPanel/chat/types';

export type { ChatPhase, UiMessage };

export interface AgentSessionState {
  bookId: number | null;
  thread: ThreadRow | null;
  messages: UiMessage[];
  phase: ChatPhase;
  error: string | null;
}

export const EMPTY_AGENT_SESSION: AgentSessionState = {
  bookId: null,
  thread: null,
  messages: [],
  phase: 'idle',
  error: null,
};

export interface AgentSessionActions {
  initAgentSessionForBook: (bookId: number) => Promise<void>;
  clearAgentSession: () => void;
  loadAgentThread: (threadId: number) => Promise<void>;
  newAgentThread: () => Promise<void>;
  setAgentSpoiler: (mode: ThreadSpoilerMode) => Promise<void>;
  sendAgentMessage: (text: string) => Promise<void>;
  cancelAgentMessage: () => void;
}

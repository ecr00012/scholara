// src/agent/types.ts
//
// OpenAI-shape chat-completion types used end-to-end in Scholara's AI Chat.
// Wire format = OpenRouter's /v1/chat/completions; the same shape is what we
// store in the DB (per-row payload only — `role` lives in its own column).

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-encoded arguments string, per OpenAI spec. Parser does NOT JSON.parse this. */
    arguments: string;
  };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    /** JSON-Schema parameters object. */
    parameters: Record<string, unknown>;
  };
}

/** Stream event protocol between Rust `chat_stream` and the TS parser. */
export type StreamEvent =
  | { kind: 'event'; event: string; data: unknown }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

// src/agent/openrouter.ts
//
// Wraps the Rust `chat_stream` / `chat_oneshot` Tauri commands, parsing
// OpenAI-shape SSE deltas streamed by OpenRouter's /v1/chat/completions.

import { Channel, invoke } from '@tauri-apps/api/core';
import type { ChatMessage, StreamEvent, ToolCall, ToolDef } from './types';

export interface ChatStreamRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  max_tokens?: number;
}

export type OnTextDelta = (delta: string) => void;

interface PendingToolCall {
  id: string;
  name: string;
  argsBuffer: string;
}

/**
 * Streams a chat completion. Returns the assembled assistant message.
 * Throws on transport error (network, http_4xx, etc.).
 */
export async function chatStream(
  req: ChatStreamRequest,
  onTextDelta: OnTextDelta,
): Promise<ChatMessage> {
  let textBuffer = '';
  const toolCalls = new Map<number, PendingToolCall>();

  let resolveDone: () => void;
  let rejectDone: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const channel = new Channel<StreamEvent>();
  channel.onmessage = (msg) => {
    if (msg.kind === 'done') return resolveDone();
    if (msg.kind === 'error') return rejectDone(new Error(msg.message));
    handleEvent(msg.data, textBufferAppender, toolCalls);
  };

  function textBufferAppender(delta: string): void {
    textBuffer += delta;
    onTextDelta(delta);
  }

  const invokePromise = invoke<void>('chat_stream', { req, onEvent: channel });
  await Promise.race([done, invokePromise.then(() => {})]);
  // Surface any error from the invoke itself (e.g., missing key, http_4xx).
  await invokePromise;

  const assembled = assembleAssistant(textBuffer, toolCalls);
  return assembled;
}

function handleEvent(
  data: unknown,
  appendText: (s: string) => void,
  toolCalls: Map<number, PendingToolCall>,
): void {
  // OpenRouter's SSE chunks follow the OpenAI Chat Completions stream format:
  //   { choices: [{ index, delta: { content?, tool_calls?, reasoning?, reasoning_content? }, finish_reason }] }
  // We ignore reasoning fields per design (silently dropped).
  const d = data as {
    choices?: Array<{
      delta?: {
        content?: string;
        tool_calls?: Array<{
          index: number;
          id?: string;
          type?: 'function';
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const delta = d?.choices?.[0]?.delta;
  if (!delta) return;

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    appendText(delta.content);
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index;
      if (typeof idx !== 'number') continue;
      let entry = toolCalls.get(idx);
      if (!entry) {
        entry = { id: '', name: '', argsBuffer: '' };
        toolCalls.set(idx, entry);
      }
      if (typeof tc.id === 'string' && tc.id.length > 0) entry.id = tc.id;
      const fn = tc.function;
      if (fn) {
        if (typeof fn.name === 'string' && fn.name.length > 0) entry.name = fn.name;
        if (typeof fn.arguments === 'string') entry.argsBuffer += fn.arguments;
      }
    }
  }
  // delta.reasoning, delta.reasoning_content, finish_reason: intentionally ignored.
}

function assembleAssistant(
  text: string,
  toolCalls: Map<number, PendingToolCall>,
): ChatMessage {
  const sortedCalls: ToolCall[] = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: c.argsBuffer },
    }));

  const hasText = text.length > 0;
  if (sortedCalls.length === 0) {
    return { role: 'assistant', content: hasText ? text : '' };
  }
  return {
    role: 'assistant',
    content: hasText ? text : null,
    tool_calls: sortedCalls,
  };
}

export interface ChatOneshotRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
}

export interface ChatOneshotResponse {
  message: ChatMessage;
}

/** Non-streaming variant. Returns the assistant message extracted from
 *  response.choices[0].message. */
export async function chatOneshot(req: ChatOneshotRequest): Promise<ChatOneshotResponse> {
  const raw = await invoke<{
    choices?: Array<{ message?: { role?: string; content?: string | null; tool_calls?: ToolCall[] } }>;
  }>('chat_oneshot', { req });
  const m = raw?.choices?.[0]?.message;
  const role = m?.role ?? 'assistant';
  if (role !== 'assistant') {
    return { message: { role: 'assistant', content: '' } };
  }
  const content = typeof m?.content === 'string' ? m.content : (m?.content === null ? null : '');
  const tool_calls = Array.isArray(m?.tool_calls) ? m!.tool_calls : undefined;
  return {
    message: tool_calls && tool_calls.length > 0
      ? { role: 'assistant', content, tool_calls }
      : { role: 'assistant', content: content ?? '' },
  };
}

/** Convenience: extract the assistant text from a ChatMessage. */
export function messageText(m: ChatMessage): string {
  if (m.role === 'assistant') return m.content ?? '';
  if (m.role === 'system' || m.role === 'user' || m.role === 'tool') return m.content;
  return '';
}

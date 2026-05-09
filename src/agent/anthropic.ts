import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AnthropicMessage,
  AnthropicToolDef,
  ContentBlock,
  StreamEvent,
  ToolUseBlock,
} from './types';

export interface ChatStreamRequest {
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicToolDef[];
  max_tokens?: number;
}

/** Fired after each delta to update the UI in flight. */
export type OnTextDelta = (delta: string) => void;

interface AccumulatedAssistant {
  blocks: ContentBlock[];
  /** Map index -> partial tool input string (built from input_json_delta events). */
  pendingToolInput: Map<number, string>;
}

/**
 * Streams a chat completion. Returns the assembled assistant message
 * (full content blocks). Throws on transport error.
 */
export async function chatStream(
  req: ChatStreamRequest,
  onTextDelta: OnTextDelta,
): Promise<AnthropicMessage> {
  const acc: AccumulatedAssistant = { blocks: [], pendingToolInput: new Map() };
  let resolveDone: () => void;
  let rejectDone: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => { resolveDone = res; rejectDone = rej; });

  const channel = new Channel<StreamEvent>();
  channel.onmessage = (msg) => {
    if (msg.kind === 'done') return resolveDone();
    if (msg.kind === 'error') return rejectDone(new Error(msg.message));
    handleEvent(acc, msg.event, msg.data, onTextDelta);
  };

  // Run the invoke in parallel; resolveDone is fired when Rust emits 'done'.
  const invokePromise = invoke<void>('chat_stream', { req, onEvent: channel });
  await Promise.race([done, invokePromise.then(() => {})]);
  // Surface any error from the invoke itself (e.g., missing key, http_4xx).
  await invokePromise;

  // Flush pending tool inputs.
  for (const [idx, raw] of acc.pendingToolInput.entries()) {
    const block = acc.blocks[idx];
    if (block?.type === 'tool_use') {
      try {
        block.input = raw ? JSON.parse(raw) : {};
      } catch {
        block.input = {};
      }
    }
  }
  return { role: 'assistant', content: acc.blocks };
}

function handleEvent(
  acc: AccumulatedAssistant,
  _event: string,
  data: unknown,
  onTextDelta: OnTextDelta,
): void {
  // Anthropic streaming protocol:
  //   message_start → content_block_start → content_block_delta(s) → content_block_stop → message_stop
  const d = data as {
    type?: string;
    index?: number;
    content_block?: { type: string; id?: string; name?: string; input?: unknown };
    delta?: { type: string; text?: string; partial_json?: string };
  };

  if (d?.type === 'content_block_start' && d.content_block) {
    const idx = d.index ?? acc.blocks.length;
    if (d.content_block.type === 'text') {
      acc.blocks[idx] = { type: 'text', text: '' };
    } else if (d.content_block.type === 'tool_use') {
      acc.blocks[idx] = {
        type: 'tool_use',
        id: d.content_block.id ?? '',
        name: d.content_block.name ?? '',
        input: {},
      };
      acc.pendingToolInput.set(idx, '');
    }
    return;
  }

  if (d?.type === 'content_block_delta' && d.delta) {
    const idx = d.index ?? 0;
    if (d.delta.type === 'text_delta' && d.delta.text) {
      const block = acc.blocks[idx] as { type: 'text'; text: string } | undefined;
      if (block?.type === 'text') {
        block.text += d.delta.text;
        onTextDelta(d.delta.text);
      }
    } else if (d.delta.type === 'input_json_delta' && d.delta.partial_json) {
      const cur = acc.pendingToolInput.get(idx) ?? '';
      acc.pendingToolInput.set(idx, cur + d.delta.partial_json);
    }
  }
}

export async function chatOneshot(req: {
  model: string;
  system?: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
}): Promise<{ content: ContentBlock[] }> {
  return invoke<{ content: ContentBlock[] }>('chat_oneshot', { req });
}

/** Convenience: extract concatenated text from a content-block array. */
export function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Convenience: extract all tool_use blocks. */
export function extractToolUses(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

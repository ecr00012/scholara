// src/agent/loop.ts
import { chatStream } from './openrouter';
import type { ChatMessage } from './types';
import { TOOL_DEFS, dispatchTool, type ToolContext } from './tools/registry';

export interface RunTurnArgs {
  model: string;
  /** System prompt body. The loop prepends a {role:'system'} message itself. */
  system: string;
  /** All prior messages in OpenAI shape. The new user turn is added below. */
  messages: ChatMessage[];
  userText: string;
  toolContext: ToolContext;
  onTextDelta: (text: string) => void;
  onAssistantMessage: (msg: ChatMessage) => void;
  /** Called whenever a batch of tool messages is produced (one per tool_call). */
  onToolResults: (msgs: ChatMessage[]) => void;
  signal?: AbortSignal;
  maxIterations?: number;
}

export async function runTurn(args: RunTurnArgs): Promise<void> {
  const userMsg: ChatMessage = { role: 'user', content: args.userText };
  const sysMsg: ChatMessage = { role: 'system', content: args.system };
  const messages: ChatMessage[] = [sysMsg, ...args.messages, userMsg];

  const limit = args.maxIterations ?? 8;
  for (let i = 0; i < limit; i++) {
    if (args.signal?.aborted) throw new Error('aborted');

    const assistant = await chatStream(
      { model: args.model, messages, tools: TOOL_DEFS },
      args.onTextDelta,
    );
    args.onAssistantMessage(assistant);
    messages.push(assistant);

    const calls = assistant.role === 'assistant' ? assistant.tool_calls ?? [] : [];
    if (calls.length === 0) return;

    const toolMessages: ChatMessage[] = await Promise.all(
      calls.map(async (tc): Promise<ChatMessage> => {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedInput = {};
        }
        const out = await dispatchTool(tc.function.name, parsedInput, args.toolContext);
        return {
          role: 'tool',
          tool_call_id: tc.id,
          content: out.content,
        };
      }),
    );
    args.onToolResults(toolMessages);
    for (const tm of toolMessages) messages.push(tm);
  }
  // If we hit the iteration cap, stop quietly — the last assistant message has already been delivered.
}

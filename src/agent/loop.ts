// src/agent/loop.ts
import { chatStream, extractText, extractToolUses } from './anthropic';
import type { AnthropicMessage, ToolResultBlock } from './types';
import { TOOL_DEFS, dispatchTool, type ToolContext } from './tools/registry';

export interface RunTurnArgs {
  model: string;
  system: string;
  messages: AnthropicMessage[];      // all prior messages (no new user yet)
  userText: string;                  // the new turn
  toolContext: ToolContext;
  /** Called as text streams in (live UI updates). */
  onTextDelta: (text: string) => void;
  /** Called whenever a fully-formed assistant message is produced (after tool execution loop iterations). */
  onAssistantMessage: (msg: AnthropicMessage) => void;
  /** Called whenever a tool_result message is produced. */
  onToolResults: (msg: AnthropicMessage) => void;
  signal?: AbortSignal;
  maxIterations?: number;
}

export async function runTurn(args: RunTurnArgs): Promise<void> {
  const userMsg: AnthropicMessage = {
    role: 'user',
    content: [{ type: 'text', text: args.userText }],
  };
  const messages: AnthropicMessage[] = [...args.messages, userMsg];

  const limit = args.maxIterations ?? 8;
  for (let i = 0; i < limit; i++) {
    if (args.signal?.aborted) throw new Error('aborted');

    const assistant = await chatStream(
      {
        model: args.model,
        system: args.system,
        messages,
        tools: TOOL_DEFS,
      },
      args.onTextDelta,
    );
    args.onAssistantMessage(assistant);
    messages.push(assistant);

    const toolUses = extractToolUses(assistant.content);
    if (toolUses.length === 0) return;

    const toolResults: ToolResultBlock[] = await Promise.all(
      toolUses.map(async (tu) => {
        const out = await dispatchTool(tu.name, tu.input, args.toolContext);
        return {
          type: 'tool_result',
          tool_use_id: tu.id,
          content: out.content,
          is_error: out.is_error,
        };
      }),
    );
    const toolMsg: AnthropicMessage = { role: 'user', content: toolResults };
    args.onToolResults(toolMsg);
    messages.push(toolMsg);
  }
  // If we hit the iteration cap, stop quietly — the last assistant message has already been delivered.
}

export { extractText };

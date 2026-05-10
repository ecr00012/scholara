import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { UiMessage } from './types';
import { ToolUseChip } from './ToolUseChip';

interface Props {
  message: UiMessage;
  /** Sibling messages used to look up tool-call name from a tool message's tool_call_id. */
  siblings: UiMessage[];
}

function findToolCallName(siblings: UiMessage[], toolCallId: string): string {
  for (const m of siblings) {
    if (m.role === 'assistant' && m.tool_calls) {
      const hit = m.tool_calls.find((tc) => tc.id === toolCallId);
      if (hit) return hit.function.name;
    }
  }
  return 'tool';
}

export function MessageBubble({ message, siblings }: Props) {
  if (message.role === 'user') {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-accent-orange px-3 py-2 text-sm text-white">
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    );
  }

  if (message.role === 'tool') {
    const name = findToolCallName(siblings, message.tool_call_id);
    return (
      <div className="mb-3 flex justify-start">
        <div className="max-w-[85%] rounded-2xl bg-white px-3 py-2 text-sm text-ink">
          <ToolUseChip toolName={name} resultsJson={message.text} isError={message.text.startsWith('tool_error:')} />
        </div>
      </div>
    );
  }

  // assistant
  const text = message.text || (message.live ? '…' : '');
  return (
    <div className="mb-3 flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-white px-3 py-2 text-sm text-ink">
        {text && (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            {message.live && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-accent-orange align-middle" />}
          </div>
        )}
        {message.tool_calls?.map((tc) => (
          <div key={tc.id} className="text-xs italic text-ink-muted">↳ calling {tc.function.name}…</div>
        ))}
      </div>
    </div>
  );
}

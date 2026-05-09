import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ContentBlock } from '../../../../agent/types';
import { ToolUseChip } from './ToolUseChip';

interface Props {
  role: 'user' | 'assistant';
  content: ContentBlock[];
  live?: boolean;
}

export function MessageBubble({ role, content, live }: Props) {
  const isUser = role === 'user';
  return (
    <div className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
          isUser ? 'bg-accent-orange text-white' : 'bg-white text-ink'
        }`}
      >
        {content.map((block, i) => {
          if (block.type === 'text') {
            const text = block.text || (live ? '…' : '');
            return isUser ? (
              <p key={i} className="whitespace-pre-wrap">{text}</p>
            ) : (
              <div key={i} className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                {live && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-accent-orange align-middle" />}
              </div>
            );
          }
          if (block.type === 'tool_use') {
            return (
              <div key={i} className="text-xs italic text-ink-muted">↳ calling {block.name}…</div>
            );
          }
          if (block.type === 'tool_result') {
            const name = (content.find((b) => b.type === 'tool_use' && b.id === block.tool_use_id) as { name?: string } | undefined)?.name ?? 'tool';
            return <ToolUseChip key={i} toolName={String(name)} resultsJson={block.content} isError={!!block.is_error} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import type { UiMessage } from './types';
import { MessageBubble } from './MessageBubble';

interface Props {
  messages: UiMessage[];
}

export function MessageList({ messages }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto p-3">
      {messages.map((m, i) => (
        <MessageBubble key={`${m.id}-${i}`} message={m} siblings={messages} />
      ))}
    </div>
  );
}

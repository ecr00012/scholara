import { useState, KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import type { ChatPhase } from './types';

interface Props {
  phase: ChatPhase;
  onSend: (text: string) => void;
  onCancel: () => void;
}

export function Composer({ phase, onSend, onCancel }: Props) {
  const [text, setText] = useState('');
  const inFlight = phase !== 'idle';

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
  function submit() {
    const trimmed = text.trim();
    if (!trimmed || inFlight) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <div className="flex items-end gap-2 border-t border-stone-200 bg-white p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        rows={1}
        placeholder="Ask about this book…"
        className="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-stone-200 px-3 py-2 text-sm focus:border-accent-orange focus:outline-none"
        disabled={inFlight}
      />
      {inFlight ? (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 text-ink-muted hover:bg-stone-100"
        >
          <Square className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-orange text-white disabled:opacity-50"
          disabled={!text.trim()}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

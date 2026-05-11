import { useCallback, useEffect, useState } from 'react';
import type { Book } from '../../../../db/types';
import { IndexingProgress } from './IndexingProgress';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { SpoilerToggle } from './SpoilerToggle';
import { HistoryPopover } from './HistoryPopover';
import { EmptyState } from './EmptyState';
import { getDb } from '../../../../db/client';
import { getIndexState } from '../../../../db/bookIndexState';
import { countChunksForBook } from '../../../../db/bookChunks';
import { useAppStore } from '../../../../store';
import { EMBEDDER_INDEX_ID } from '../../../../rag/embedder';

interface Props {
  book: Book;
}

export function AiChatRoot({ book }: Props) {
  const state = useAppStore((s) => s.agentSession);
  const send = useAppStore((s) => s.sendAgentMessage);
  const cancel = useAppStore((s) => s.cancelAgentMessage);
  const setSpoiler = useAppStore((s) => s.setAgentSpoiler);
  const newThread = useAppStore((s) => s.newAgentThread);
  const loadThread = useAppStore((s) => s.loadAgentThread);
  const [indexReady, setIndexReady] = useState<boolean | null>(null);
  const handleIndexReady = useCallback(() => setIndexReady(true), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDb();
      const state = await getIndexState(db, book.id);
      const hasCurrentIndex =
        state?.status === 'ready' && state.embedder_model === EMBEDDER_INDEX_ID;
      const chunkCount = hasCurrentIndex
        ? await countChunksForBook(db, book.id)
        : 0;
      if (cancelled) return;
      setIndexReady(hasCurrentIndex && chunkCount > 0);
    })();
    return () => { cancelled = true; };
  }, [book.id]);

  if (indexReady === null) return null;
  if (!indexReady) return <IndexingProgress book={book} onReady={handleIndexReady} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-stone-100 px-3">
        <div className="min-w-0 truncate text-sm text-ink-muted">
          {state.thread?.title || 'New chat'}
        </div>
        <div className="flex items-center gap-1">
          <HistoryPopover
            bookId={book.id}
            activeThreadId={state.thread?.id ?? null}
            onPick={loadThread}
            onNew={newThread}
          />
          <SpoilerToggle
            mode={state.thread?.spoiler_mode ?? 1}
            positionLabel={book.current_position ? 'your current page' : ''}
            onChange={setSpoiler}
          />
        </div>
      </div>
      {state.messages.length === 0 ? (
        <div className="flex flex-1">
          <EmptyState book={book} />
        </div>
      ) : (
        <MessageList messages={state.messages} />
      )}
      {state.error && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {state.error}
        </div>
      )}
      <Composer phase={state.phase} onSend={send} onCancel={cancel} />
    </div>
  );
}

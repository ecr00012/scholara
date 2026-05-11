import { useEffect, useState } from 'react';
import type { Book } from '../../../../db/types';
import {
  getBackgroundIndexSnapshot,
  startBackgroundIndexing,
  subscribeToBackgroundIndexing,
  type BackgroundIndexSnapshot,
} from '../../../../rag/backgroundIndexing';

interface Props {
  book: Book;
  onReady: () => void;
}

export function IndexingProgress({ book, onReady }: Props) {
  const [snapshot, setSnapshot] = useState<BackgroundIndexSnapshot>(() =>
    getBackgroundIndexSnapshot(book.id),
  );
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToBackgroundIndexing(book.id, (next) => {
      setSnapshot(next);
      if (next.status === 'ready') {
        onReady();
      }
    });
    void startBackgroundIndexing({
      id: book.id,
      file_path: book.file_path,
      file_type: book.file_type,
    });
    return unsubscribe;
  }, [book.file_path, book.file_type, book.id, retryNonce, onReady]);

  if (snapshot.status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-serif text-lg text-ink">Indexing failed.</p>
        <p className="max-w-sm text-sm text-ink-muted">{snapshot.error}</p>
        <button
          type="button"
          className="rounded-md bg-accent-orange px-3 py-1.5 text-sm text-white hover:opacity-90"
          onClick={() => setRetryNonce((n) => n + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  const { progress } = snapshot;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-serif text-lg text-ink">Preparing study mode for {book.title}…</p>
      <div className="h-2 w-64 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full bg-accent-orange transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-ink-muted">
        {progress.phase === 'embedding'
          ? `Embedding chunks ${progress.done}/${progress.total}`
          : progress.phase === 'extracting'
          ? 'Extracting text…'
          : 'Finalizing…'}
      </p>
    </div>
  );
}

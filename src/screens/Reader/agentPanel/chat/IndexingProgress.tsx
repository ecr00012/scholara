import { useEffect, useState } from 'react';
import type { Book } from '../../../../db/types';
import { ensureBookIndexed, type IndexProgress } from '../../../../rag/index';

interface Props {
  book: Book;
  onReady: () => void;
}

export function IndexingProgress({ book, onReady }: Props) {
  const [progress, setProgress] = useState<IndexProgress>({ total: 0, done: 0, phase: 'extracting' });
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setError(null);
    setProgress({ total: 0, done: 0, phase: 'extracting' });
    (async () => {
      try {
        await ensureBookIndexed(
          {
            id: book.id,
            file_path: book.file_path,
            file_type: book.file_type,
          },
          (p) => { if (!cancelled) setProgress(p); },
          controller.signal,
        );
        if (!cancelled) onReady();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.message === 'aborted') return;
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [book.file_path, book.file_type, book.id, retryNonce, onReady]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-serif text-lg text-ink">Indexing failed.</p>
        <p className="max-w-sm text-sm text-ink-muted">{error}</p>
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

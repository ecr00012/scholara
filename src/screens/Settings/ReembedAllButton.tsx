import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getDb } from '../../db/client';
import { upsertIndexState } from '../../db/bookIndexState';
import { useAppStore } from '../../store';

export function ReembedAllButton() {
  const books = useAppStore((s) => s.books);
  const [busy, setBusy] = useState(false);

  async function reembed() {
    setBusy(true);
    try {
      const db = await getDb();
      for (const b of books) {
        // Status-flip only — chunks are left in place and will be replaced
        // when the indexer re-runs on next book open.
        await upsertIndexState(db, {
          book_id: b.id,
          status: 'pending',
          chunk_count: null,
          embedder_model: null,
          content_hash: null,
          error: null,
        });
      }
      toast.success(
        books.length === 0
          ? 'No books to re-embed.'
          : 'All books will re-embed the next time you open them.',
      );
    } catch (err) {
      toast.error(`Could not reset embeddings: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Re-embed Books
      </h2>
      <p className="text-sm text-ink-muted">
        Mark every book as needing a fresh embedding pass. Useful if RAG results feel stale.
      </p>
      <Button
        variant="outline"
        onClick={() => void reembed()}
        disabled={busy}
      >
        {busy ? 'Resetting…' : 'Re-embed all books on next open'}
      </Button>
    </section>
  );
}

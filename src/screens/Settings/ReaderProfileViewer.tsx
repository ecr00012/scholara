import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getDb } from '../../db/client';
import {
  getProfile,
  deleteProfile,
  type ReaderProfileRow,
} from '../../db/readerProfile';

export function ReaderProfileViewer() {
  const [row, setRow] = useState<ReaderProfileRow | null>(null);

  async function refresh() {
    try {
      const db = await getDb();
      setRow(await getProfile(db, 'global'));
    } catch (err) {
      toast.error(`Could not load reader profile: ${(err as Error).message}`);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function clear() {
    try {
      const db = await getDb();
      await deleteProfile(db, 'global');
      await refresh();
    } catch (err) {
      toast.error(`Could not clear profile: ${(err as Error).message}`);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Reader Profile
      </h2>
      <p className="text-sm text-ink-muted">
        What Scholara has learned about your reading.
      </p>
      <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-ink">
        {row?.summary ||
          'No profile yet — start chatting and Scholara will summarize your interests over time.'}
      </div>
      {row && (
        <button
          type="button"
          onClick={() => void clear()}
          className="text-xs text-ink-muted underline hover:text-ink"
        >
          Clear profile
        </button>
      )}
    </section>
  );
}

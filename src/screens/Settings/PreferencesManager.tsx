import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getDb } from '../../db/client';
import {
  listPreferences,
  insertPreference,
  deletePreference,
  type PreferenceRow,
} from '../../db/preferences';

export function PreferencesManager() {
  const [rows, setRows] = useState<PreferenceRow[]>([]);
  const [text, setText] = useState('');

  async function refresh() {
    try {
      const db = await getDb();
      setRows(await listPreferences(db, null));
    } catch (err) {
      toast.error(`Could not load preferences: ${(err as Error).message}`);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function add() {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const db = await getDb();
      await insertPreference(db, {
        scope: 'global',
        book_id: null,
        text: trimmed,
      });
      setText('');
      await refresh();
    } catch (err) {
      toast.error(`Could not save preference: ${(err as Error).message}`);
    }
  }

  async function remove(id: number) {
    try {
      const db = await getDb();
      await deletePreference(db, id);
      await refresh();
    } catch (err) {
      toast.error(`Could not delete preference: ${(err as Error).message}`);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Pinned Preferences
      </h2>
      <p className="text-sm text-ink-muted">
        Short instructions Scholara applies to every chat (e.g. "Prefer short answers.").
      </p>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="e.g. Prefer short answers."
          className="flex-1 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-ink"
        />
        <Button type="button" variant="default" onClick={() => void add()}>
          Pin
        </Button>
      </div>
      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-ink"
            >
              <span>{p.text}</span>
              <button
                type="button"
                aria-label="Delete preference"
                onClick={() => void remove(p.id)}
                className="text-ink-muted hover:text-ink"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Clock, Plus } from 'lucide-react';
import { getDb } from '../../../../db/client';
import * as threadsDb from '../../../../db/threads';
import type { ThreadRow } from '../../../../db/types';

interface Props {
  bookId: number;
  activeThreadId: number | null;
  onPick: (id: number) => void;
  onNew: () => void;
}

export function HistoryPopover({ bookId, activeThreadId, onPick, onNew }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const db = await getDb();
      const [list, c] = await Promise.all([
        threadsDb.listThreadsForBook(db, bookId),
        threadsDb.countMessagesByThread(db, bookId),
      ]);
      if (cancelled) return;
      setRows(list);
      setCounts(c);
    })();
    return () => { cancelled = true; };
  }, [open, bookId, activeThreadId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onClick);
    return () => document.removeEventListener('pointerdown', onClick);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label="Chat history"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-stone-100"
      >
        <Clock className="h-4 w-4" />
      </button>
      {open && (
        <div ref={popRef} className="absolute right-0 top-9 z-30 w-72 overflow-hidden rounded-lg border border-stone-200 bg-cream shadow-xl">
          <button
            type="button"
            onClick={() => { onNew(); setOpen(false); }}
            className="flex w-full items-center gap-2 border-b border-stone-100 px-3 py-2 text-left text-sm text-ink hover:bg-white"
          >
            <Plus className="h-4 w-4" /> New chat
          </button>
          <div className="max-h-72 overflow-y-auto">
            {rows.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onPick(t.id); setOpen(false); }}
                className={`block w-full px-3 py-2 text-left text-sm transition ${
                  t.id === activeThreadId ? 'bg-white text-ink' : 'text-ink-muted hover:bg-white/70 hover:text-ink'
                }`}
              >
                <div className="truncate">{t.title || `Chat from ${t.created_at.slice(0, 10)}`}</div>
                <div className="text-xs text-ink-muted">{counts.get(t.id) ?? 0} messages</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

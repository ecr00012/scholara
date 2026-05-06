import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  formatPositionLabel,
  getSourcePositionFromJson,
  type Position,
} from '../../lib/positionShape';
import { useAppStore } from '../../store';

const OPEN_NOTE_EVENT = 'scholara:open-note';
const GO_TO_SOURCE_EVENT = 'scholara:go-to-source';

export function NotePeek() {
  const books = useAppStore((state) => state.books);
  const currentBookId = useAppStore((state) => state.currentBookId);
  const notes = useAppStore((state) => state.currentBookNotes);
  const book = useMemo(
    () => books.find((candidate) => candidate.id === currentBookId) ?? null,
    [books, currentBookId],
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const note = useMemo(
    () => notes.find((candidate) => candidate.id === selectedId) ?? null,
    [notes, selectedId],
  );

  useEffect(() => {
    const handleOpen = (event: Event) => {
      setSelectedId((event as CustomEvent<number>).detail);
    };

    window.addEventListener(OPEN_NOTE_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_NOTE_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    if (!note && selectedId !== null) {
      setSelectedId(null);
    }
  }, [note, selectedId]);

  return (
    <AnimatePresence>
      {note ? (
        <motion.aside
          key={note.id}
          role="dialog"
          aria-label="Linked note"
          className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-amber-100 bg-white/90 p-5 text-ink shadow-xl backdrop-blur-md"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18 }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="font-serif text-base text-ink">
                {note.note_text ? 'Linked note' : 'Highlight'}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {formatPositionLabel(note.page_or_position, {
                  epubLocations: book?.epub_locations,
                })}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close linked note"
              onClick={() => setSelectedId(null)}
              className="rounded-full p-1 transition hover:bg-stone-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {note.quote_text ? (
            <button
              type="button"
              className="block w-full rounded-2xl border border-accent-orange/30 bg-accent-orange/10 px-4 py-2 text-left font-serif text-sm italic text-accent-orange transition hover:bg-accent-orange/15 focus:outline-none focus:ring-2 focus:ring-amber-300"
              onClick={() => {
                const position = getSourcePositionFromJson(note.page_or_position);
                if (!position) return;
                window.dispatchEvent(
                  new CustomEvent<Position>(GO_TO_SOURCE_EVENT, {
                    detail: position,
                  }),
                );
                setSelectedId(null);
              }}
            >
              &ldquo;{note.quote_text}&rdquo;
            </button>
          ) : null}

          {note.note_text ? (
            <p className="mt-4 text-sm leading-6 text-ink">{note.note_text}</p>
          ) : null}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

import { useEffect, useState } from 'react';
import { Feather, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Book } from '../../db/types';
import { ORANGE } from '../../lib/theme';
import {
  serializePosition,
  serializeQuoteRange,
  type Position,
  type QuoteRange,
} from '../../lib/positionShape';
import { useAppStore } from '../../store';

const SELECTION_EVENT = 'scholara:selection';
const SET_QUOTE_EVENT = 'scholara:set-quote';

interface Draft {
  quote: { text: string; range: QuoteRange } | null;
  body: string;
}

interface SelectionDetail {
  kind: 'word' | 'range';
  text: string;
  range: QuoteRange;
}

interface Props {
  book: Book;
  fullWidth: boolean;
}

export function NotesModeInput({ book, fullWidth }: Props) {
  const insertNote = useAppStore((state) => state.insertNoteForCurrentBook);
  const setNotesModeActive = useAppStore((state) => state.setNotesModeActive);
  const [draft, setDraft] = useState<Draft>({ quote: null, body: '' });

  useEffect(() => {
    const handleSelection = (event: Event) => {
      const detail = (event as CustomEvent<SelectionDetail>).detail;
      setDraft((current) => ({
        ...current,
        quote: { text: detail.text, range: detail.range },
      }));
    };

    window.addEventListener(SELECTION_EVENT, handleSelection);
    return () => window.removeEventListener(SELECTION_EVENT, handleSelection);
  }, []);

  useEffect(() => {
    const handleSetQuote = (event: Event) => {
      const detail = (event as CustomEvent<Omit<SelectionDetail, 'kind'>>).detail;
      setDraft((current) => ({
        ...current,
        quote: { text: detail.text, range: detail.range },
      }));
    };

    window.addEventListener(SET_QUOTE_EVENT, handleSetQuote);
    return () => window.removeEventListener(SET_QUOTE_EVENT, handleSetQuote);
  }, []);

  const canSave = draft.quote !== null || draft.body.trim() !== '';

  async function onSave() {
    try {
      const pageOrPosition = draft.quote
        ? serializeQuoteRange(draft.quote.range)
        : readCurrentPosition(book);

      if (!pageOrPosition) {
        toast.error('Could not detect current position.');
        return;
      }

      await insertNote({
        page_or_position: pageOrPosition,
        note_text: draft.body.trim() || null,
        quote_text: draft.quote?.text ?? null,
      });

      setDraft({ quote: null, body: '' });
      setNotesModeActive(false);
      toast.success('Saved');
    } catch (error) {
      toast.error(`Could not save note: ${(error as Error).message}`);
    }
  }

  return (
    <div
      className={
        fullWidth
          ? 'flex w-[80vw] flex-col items-stretch'
          : 'flex w-full flex-col items-stretch'
      }
    >
      {draft.quote ? (
        <div className="relative mx-4 mb-2">
          <div className="absolute left-8 top-full h-3 w-px bg-accent-orange" />
          <div className="flex items-center gap-3 rounded-full border border-accent-orange/35 bg-accent-orange/15 px-4 py-2 text-accent-orange shadow-sm">
            <p className="min-w-0 flex-1 truncate font-serif text-sm italic">
              &ldquo;{draft.quote.text}&rdquo;
            </p>
            <button
              type="button"
              aria-label="Remove selected quote"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  quote: null,
                }))
              }
              className="rounded-full p-1 transition hover:bg-accent-orange/15"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
      <div
        className={
          fullWidth
            ? 'flex items-center gap-3 rounded-full border border-amber-100/70 bg-white/55 px-4 py-3 shadow-lg backdrop-blur-md'
            : 'flex items-center gap-2 rounded-2xl border border-amber-100 bg-white/80 px-3 py-2 shadow-sm'
        }
      >
        <input
          autoFocus
          type="text"
          value={draft.body}
          placeholder="Add a note…"
          onChange={(event) =>
            setDraft((current) => ({ ...current, body: event.target.value }))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canSave) {
              void onSave();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        <button
          type="button"
          aria-label="Save note"
          disabled={!canSave}
          onClick={() => {
            void onSave();
          }}
          className="rounded-full p-1 transition disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Feather className="h-4 w-4" style={{ color: ORANGE, fill: ORANGE }} />
        </button>
      </div>
    </div>
  );
}

function readCurrentPosition(book: Book): string | null {
  if (!book.current_position) return null;

  try {
    const position = JSON.parse(book.current_position) as Position;
    if (
      (position.type === 'pdf' || position.type === 'epub') &&
      typeof position.fraction === 'number'
    ) {
      return serializePosition(position);
    }
  } catch {
    return null;
  }

  return null;
}

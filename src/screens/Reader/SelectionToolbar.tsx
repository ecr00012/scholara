import { useEffect, useState } from 'react';
import type { Book } from '../../db/types';
import type { QuoteRange } from '../../lib/positionShape';
import { useAppStore } from '../../store';
import { dispatchOpenDictionary } from './DictionaryModal';

const SELECTION_EVENT = 'scholara:selection';
const SET_QUOTE_EVENT = 'scholara:set-quote';

interface PendingSelection {
  kind: 'word' | 'range';
  text: string;
  range: QuoteRange;
  rect: { x: number; y: number };
}

interface Props {
  book: Book;
}

export function SelectionToolbar({ book: _book }: Props) {
  const notesModeActive = useAppStore((state) => state.notesModeActive);
  const setNotesModeActive = useAppStore((state) => state.setNotesModeActive);
  const [pending, setPending] = useState<PendingSelection | null>(null);

  useEffect(() => {
    const handleSelection = (event: Event) => {
      const detail = (event as CustomEvent<Omit<PendingSelection, 'rect'>>).detail;
      const selection = window.getSelection();
      let rect = { x: window.innerWidth / 2, y: 96 };

      if (selection && selection.rangeCount > 0) {
        const bounds = selection.getRangeAt(0).getBoundingClientRect();
        if (bounds.width > 0 || bounds.height > 0) {
          rect = {
            x: bounds.left + bounds.width / 2,
            y: bounds.bottom + 10,
          };
        }
      }

      setPending({ ...detail, rect });
    };

    const dismiss = () => setPending(null);

    window.addEventListener(SELECTION_EVENT, handleSelection);
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('resize', dismiss);

    return () => {
      window.removeEventListener(SELECTION_EVENT, handleSelection);
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('resize', dismiss);
    };
  }, []);

  if (!pending) return null;

  const isWord = pending.kind === 'word';
  const showAddToDictionary = !notesModeActive && isWord;
  const showHighlightAsQuote = notesModeActive;
  const showTakeNoteOnThis = !notesModeActive && !isWord;

  return (
    <div
      className="fixed z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-100 bg-cream/95 px-3 py-2 shadow-lg"
      style={{ left: pending.rect.x, top: pending.rect.y }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {showAddToDictionary ? (
        <button
          type="button"
          className="text-sm text-ink transition hover:underline"
          onClick={() => {
            const cleaned = sanitizeWord(pending.text);
            if (!cleaned) return;
            dispatchOpenDictionary(cleaned);
            setPending(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          Add to Dictionary
        </button>
      ) : null}
      {showHighlightAsQuote ? (
        <button
          type="button"
          className="text-sm text-ink transition hover:underline"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent(SET_QUOTE_EVENT, {
                detail: { text: pending.text, range: pending.range },
              }),
            );
            setPending(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          Highlight as Quote
        </button>
      ) : null}
      {showTakeNoteOnThis ? (
        <button
          type="button"
          className="text-sm text-ink transition hover:underline"
          onClick={() => {
            setNotesModeActive(true);
            queueMicrotask(() => {
              window.dispatchEvent(
                new CustomEvent(SELECTION_EVENT, {
                  detail: {
                    kind: pending.kind,
                    text: pending.text,
                    range: pending.range,
                  },
                }),
              );
            });
            setPending(null);
          }}
        >
          Take a note on this
        </button>
      ) : null}
    </div>
  );
}

function sanitizeWord(text: string): string {
  const trimmed = text.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!trimmed || /\s/.test(trimmed)) return '';
  return trimmed;
}

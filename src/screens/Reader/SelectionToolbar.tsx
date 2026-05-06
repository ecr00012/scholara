import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Book } from '../../db/types';
import { serializeQuoteRange, type QuoteRange } from '../../lib/positionShape';
import { useAppStore } from '../../store';
import { dispatchOpenDictionary } from './DictionaryModal';

const SELECTION_EVENT = 'scholara:selection';
const DISMISS_EVENT = 'scholara:dismiss-toolbar';
const CLEAR_SELECTION_EVENT = 'scholara:clear-selection';
// Ignore selection events arriving within this window after a save click — guards
// against the iframe redraws / late mouseups that would otherwise re-show the
// toolbar with the same selection and double-save.
const POST_ACTION_DEAD_MS = 400;

interface PendingSelection {
  kind: 'word' | 'range';
  text: string;
  range: QuoteRange;
  rect: { x: number; y: number };
}

interface SelectionEventDetail extends Omit<PendingSelection, 'rect'> {
  rect?: { x: number; y: number };
}

interface Props {
  book: Book;
}

export function SelectionToolbar({ book: _book }: Props) {
  const notesModeActive = useAppStore((state) => state.notesModeActive);
  const insertNote = useAppStore((state) => state.insertNoteForCurrentBook);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const lastActionAtRef = useRef<number>(0);

  useEffect(() => {
    const handleSelection = (event: Event) => {
      if (notesModeActive) {
        setPending(null);
        return;
      }

      // Suppress lingering dispatches that arrive immediately after a click
      // action (Bug B): epub.js redraws and out-of-order mouseups can re-fire
      // selection events even though the user only clicked once.
      if (Date.now() - lastActionAtRef.current < POST_ACTION_DEAD_MS) {
        return;
      }

      const detail = (event as CustomEvent<SelectionEventDetail>).detail;
      const selection = window.getSelection();
      let rect = detail.rect ?? { x: window.innerWidth / 2, y: 96 };

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

    // Capture phase so we run before any bubble-phase stopPropagation. We
    // ignore clicks that originate inside the toolbar itself; everything else
    // (including pdf.js text layer clicks) collapses the toolbar.
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const toolbar = toolbarRef.current;
      const target = event.target as Node | null;
      if (toolbar && target && toolbar.contains(target)) return;
      setPending(null);
    };

    window.addEventListener(SELECTION_EVENT, handleSelection);
    window.addEventListener(DISMISS_EVENT, dismiss);
    window.addEventListener('resize', dismiss);
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);

    return () => {
      window.removeEventListener(SELECTION_EVENT, handleSelection);
      window.removeEventListener(DISMISS_EVENT, dismiss);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    };
  }, [notesModeActive]);

  if (!pending) return null;

  const isWord = pending.kind === 'word';
  const showAddToDictionary = !notesModeActive && isWord;
  const showHighlightText = !notesModeActive && !isWord;

  function clearAllSelections() {
    window.getSelection()?.removeAllRanges();
    // EpubReader listens for this and clears the iframe selection too.
    window.dispatchEvent(new CustomEvent(CLEAR_SELECTION_EVENT));
  }

  async function saveHighlight(snapshot: PendingSelection) {
    lastActionAtRef.current = Date.now();
    setPending(null);
    clearAllSelections();

    try {
      await insertNote({
        page_or_position: serializeQuoteRange(snapshot.range),
        note_text: null,
        quote_text: snapshot.text,
      });
      toast.success('Highlighted');
    } catch (error) {
      toast.error(`Could not save highlight: ${(error as Error).message}`);
    }
  }

  return (
    <div
      ref={toolbarRef}
      className="fixed z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-100 bg-cream/95 px-3 py-2 shadow-lg"
      style={{ left: pending.rect.x, top: pending.rect.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {showAddToDictionary ? (
        <button
          type="button"
          className="text-sm text-ink transition hover:underline"
          onClick={() => {
            const cleaned = sanitizeWord(pending.text);
            if (!cleaned) return;
            lastActionAtRef.current = Date.now();
            dispatchOpenDictionary(cleaned);
            setPending(null);
            clearAllSelections();
          }}
        >
          Add to Dictionary
        </button>
      ) : null}
      {showHighlightText ? (
        <button
          type="button"
          className="text-sm text-ink transition hover:underline"
          onClick={() => {
            const snapshot = pending;
            if (!snapshot) return;
            void saveHighlight(snapshot);
          }}
        >
          Highlight text
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

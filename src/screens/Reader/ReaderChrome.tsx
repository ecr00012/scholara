import { useEffect } from 'react';
import { Feather } from 'lucide-react';
import type { Book } from '../../db/types';
import { ORANGE } from '../../lib/theme';
import { useAppStore } from '../../store';
import { ModeToggle } from './ModeToggle';

interface Props {
  book: Book;
  variant: 'split' | 'fullscreen';
}

export function ReaderChrome({ book, variant: _variant }: Props) {
  const closeBook = useAppStore((s) => s.closeBook);
  const setBookDisplayMode = useAppStore((s) => s.setBookDisplayMode);
  const notesModeActive = useAppStore((s) => s.notesModeActive);
  const setNotesModeActive = useAppStore((s) => s.setNotesModeActive);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input,textarea,[contenteditable="true"]')) return;
      if (event.key === 'n') setNotesModeActive(!notesModeActive);
      if (event.key === 'Escape') setNotesModeActive(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notesModeActive, setNotesModeActive]);

  const label = readableLabel(book);

  return (
    <div className="flex h-14 items-center justify-between border-b border-stone-200 bg-cream/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={closeBook}
          className="font-serif text-sm text-ink-muted"
        >
          ← Library
        </button>
        {label ? (
          <span className="truncate text-xs text-ink-muted">{label}</span>
        ) : null}
      </div>
      <ModeToggle
        value={book.display_mode}
        onChange={(mode) => {
          void setBookDisplayMode(book.id, mode);
        }}
      />
      <button
        type="button"
        aria-label="Take a note (n)"
        title="Take a note (n)"
        onClick={() => setNotesModeActive(!notesModeActive)}
        className="rounded p-1 transition"
      >
        <Feather
          className="h-5 w-5"
          style={
            notesModeActive
              ? { color: ORANGE, fill: ORANGE }
              : { color: ORANGE, fill: 'transparent' }
          }
        />
      </button>
    </div>
  );
}

function readableLabel(book: Book): string {
  if (!book.current_position) return '';

  try {
    const position = JSON.parse(book.current_position) as {
      label?: string;
      fraction?: number;
    };
    if (!position.label) return '';
    return `${position.label}${
      typeof position.fraction === 'number'
        ? ` · ${Math.round(position.fraction * 100)}%`
        : ''
    }`;
  } catch {
    return '';
  }
}

import { useEffect, useState } from 'react';
import { Feather } from 'lucide-react';
import type { Book } from '../../db/types';
import { formatPositionLabel } from '../../lib/positionShape';
import { ORANGE } from '../../lib/theme';
import { useAppStore } from '../../store';
import { ChapterIndexPopover } from './ChapterIndexPopover';
import { ModeToggle } from './ModeToggle';
import { ReaderSearchPopover } from './ReaderSearchPopover';
import { TextPreferencesDialog } from './TextPreferencesDialog';

interface Props {
  book: Book;
  variant: 'split' | 'fullscreen';
}

export function ReaderChrome({ book, variant: _variant }: Props) {
  const closeBook = useAppStore((s) => s.closeBook);
  const setBookDisplayMode = useAppStore((s) => s.setBookDisplayMode);
  const notesModeActive = useAppStore((s) => s.notesModeActive);
  const setNotesModeActive = useAppStore((s) => s.setNotesModeActive);
  const [textPrefsOpen, setTextPrefsOpen] = useState(false);

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
  const epubControlsDisabled = book.file_type !== 'epub';

  return (
    <div className="grid h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-stone-200 bg-cream/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={closeBook}
          className="shrink-0 font-serif text-sm text-ink-muted transition hover:text-ink"
        >
          ← Library
        </button>
        <ChapterIndexPopover disabled={epubControlsDisabled} />
        {label ? (
          <span className="min-w-0 truncate text-xs text-ink-muted">
            {label}
          </span>
        ) : null}
      </div>

      <div className="flex justify-center">
        <ModeToggle
          value={book.display_mode}
          onChange={(mode) => {
            void setBookDisplayMode(book.id, mode);
          }}
        />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1">
        <TextPreferencesDialog
          disabled={epubControlsDisabled}
          open={textPrefsOpen}
          onOpenChange={setTextPrefsOpen}
        />
        <ReaderSearchPopover disabled={epubControlsDisabled} />
        <button
          type="button"
          aria-label="Take a note (n)"
          title="Take a note (n)"
          onClick={() => setNotesModeActive(!notesModeActive)}
          className="flex size-8 items-center justify-center rounded-md transition hover:bg-stone-100"
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
    </div>
  );
}

function readableLabel(book: Book): string {
  if (!book.current_position) return '';
  return formatPositionLabel(book.current_position, {
    epubLocations: book.epub_locations,
  });
}

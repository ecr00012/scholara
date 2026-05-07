import { useMemo } from 'react';
import type { Book } from '../../../db/types';
import { useAppStore } from '../../../store';
import type { ReaderNavItem } from '../readerSupport';
import { filterNotesByScope, NotesList } from './NotesTab';

interface Props {
  book: Book;
  scope: ReaderNavItem | null;
}

export function HighlightsTab({ book, scope }: Props) {
  const currentBookNotes = useAppStore((state) => state.currentBookNotes);
  const notes = useMemo(
    () =>
      filterNotesByScope(
        currentBookNotes.filter((note) => note.quote_text !== null),
        scope,
      ),
    [currentBookNotes, scope],
  );

  return <NotesList book={book} emptyMessage="No highlights yet." notes={notes} />;
}

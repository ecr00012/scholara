import { useMemo } from 'react';
import type { Book } from '../../../db/types';
import { useAppStore } from '../../../store';
import { NotesList } from './NotesTab';

interface Props {
  book: Book;
}

export function HighlightsTab({ book: _book }: Props) {
  const currentBookNotes = useAppStore((state) => state.currentBookNotes);
  const notes = useMemo(
    () => currentBookNotes.filter((note) => note.quote_text !== null),
    [currentBookNotes],
  );

  return <NotesList emptyMessage="No highlights yet." notes={notes} />;
}

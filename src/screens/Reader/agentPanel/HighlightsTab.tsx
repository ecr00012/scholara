import type { Book } from '../../../db/types';
import { useAppStore } from '../../../store';
import { NotesList } from './NotesTab';

interface Props {
  book: Book;
}

export function HighlightsTab({ book: _book }: Props) {
  const notes = useAppStore((state) =>
    state.currentBookNotes.filter((note) => note.quote_text !== null),
  );

  return <NotesList emptyMessage="No highlights yet." notes={notes} />;
}

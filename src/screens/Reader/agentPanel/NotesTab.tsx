import { Trash2 } from 'lucide-react';
import type { Book, NoteRow } from '../../../db/types';
import { useAppStore } from '../../../store';

const OPEN_NOTE_EVENT = 'scholara:open-note';

interface Props {
  book: Book;
}

interface NoteListProps {
  emptyMessage: string;
  notes: NoteRow[];
}

export function NotesTab({ book: _book }: Props) {
  const notes = useAppStore((state) => state.currentBookNotes);

  return <NotesList emptyMessage="No notes yet." notes={notes} />;
}

export function NotesList({ emptyMessage, notes }: NoteListProps) {
  const deleteNote = useAppStore((state) => state.deleteNote);

  if (notes.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyMessage}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {notes.map((note) => {
        const label = readNoteLabel(note.page_or_position);

        return (
          <li key={note.id} className="rounded-2xl border border-stone-200 bg-cream p-3">
            <button
              type="button"
              className="block w-full text-left"
              onClick={() => openNote(note.id)}
            >
              {note.quote_text ? (
                <p className="mb-2 rounded-2xl border border-accent-orange/25 bg-accent-orange/10 px-3 py-1.5 font-serif text-sm italic text-accent-orange">
                  &ldquo;{note.quote_text}&rdquo;
                </p>
              ) : null}
              {note.note_text ? (
                <p className="text-sm leading-6 text-ink">{note.note_text}</p>
              ) : (
                <p className="text-sm text-ink-muted">Highlight</p>
              )}
            </button>
            <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
              <span>{label}</span>
              <button
                type="button"
                aria-label="Delete note"
                onClick={() => {
                  void deleteNote(note.id);
                }}
                className="rounded-full p-1 transition hover:bg-stone-100 hover:text-ink"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function openNote(noteId: number): void {
  window.dispatchEvent(new CustomEvent<number>(OPEN_NOTE_EVENT, { detail: noteId }));
}

function readNoteLabel(pageOrPosition: string): string {
  try {
    const parsed = JSON.parse(pageOrPosition) as
      | { label?: string }
      | { start?: { label?: string } };

    if ('label' in parsed && parsed.label) {
      return parsed.label;
    }

    if ('start' in parsed && parsed.start?.label) {
      return parsed.start.label;
    }
  } catch {
    return '';
  }

  return '';
}

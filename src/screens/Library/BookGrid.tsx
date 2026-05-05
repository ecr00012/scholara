import type { Book } from '../../db/types';
import { BookTile } from './BookTile';
import { AddBookButton } from './AddBookButton';

interface Props {
  books: Book[];
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
  onAdded: (book: Book) => void;
}

export function BookGrid({ books, onEdit, onDelete, onAdded }: Props) {
  if (books.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <AddBookButton variant="cta" onAdded={onAdded} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-8">
      {books.map((b) => (
        <BookTile key={b.id} book={b} onEdit={onEdit} onDelete={onDelete} />
      ))}
      <AddBookButton variant="tile" onAdded={onAdded} />
    </div>
  );
}

import type { GutenbergBook } from './types';
import { BookTile } from './BookTile';

interface Props {
  books: GutenbergBook[];
  onSelect: (book: GutenbergBook) => void;
}

export function BookGrid2x2({ books, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {books.map((book) => (
        <BookTile key={book.id} book={book} onClick={() => onSelect(book)} />
      ))}
    </div>
  );
}

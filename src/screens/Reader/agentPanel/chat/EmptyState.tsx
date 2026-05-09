import type { Book } from '../../../../db/types';

interface Props {
  book: Book;
}

export function EmptyState({ book }: Props) {
  return (
    <div className="m-auto max-w-sm p-6 text-center">
      <p className="font-serif text-base text-ink">
        Discuss <span className="italic">{book.title}</span> with a reader who's been there before.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        Ask about a passage, a character, or a word.
      </p>
    </div>
  );
}

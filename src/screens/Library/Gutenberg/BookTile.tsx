import { useState } from 'react';
import { GeneratedCover } from '../GeneratedCover';
import type { GutenbergBook } from './types';

interface Props {
  book: GutenbergBook;
  onClick: () => void;
}

export function BookTile({ book, onClick }: Props) {
  const [imgError, setImgError] = useState(false);
  const author = book.authors[0]?.name ?? null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 flex-col text-left focus:outline-none"
      aria-label={`Open ${book.title}`}
    >
      <div className="aspect-[2/3] w-full overflow-hidden rounded-sm border border-stone-200 bg-stone-100 transition group-hover:ring-1 group-hover:ring-accent-amber/50">
        {!imgError && book.cover_image ? (
          <img
            src={book.cover_image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <GeneratedCover title={book.title} author={author} />
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 font-serif text-xs leading-tight text-ink">
        {book.title}
      </p>
      {author && (
        <p className="line-clamp-1 text-[11px] text-ink-muted">{author}</p>
      )}
    </button>
  );
}

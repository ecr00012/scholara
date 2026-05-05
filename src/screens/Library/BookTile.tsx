import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Book } from '../../db/types';
import { GeneratedCover } from './GeneratedCover';

interface Props {
  book: Book;
  onEdit: (book: Book) => void;
}

export function BookTile({ book, onEdit }: Props) {
  return (
    // Added 'relative' to parent so absolute positioning works correctly
    <div className="group relative flex flex-col gap-2">
      {/* Main clickable area */}
      <button
        type="button"
        className="relative aspect-[2/3] w-full overflow-hidden rounded-md transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent-gold"
        onClick={() => {
          console.log('Open book', book.id);
          toast('Reader coming in the next phase.');
        }}
        aria-label={`Open ${book.title}`}
      >
        <GeneratedCover
          title={book.title}
          author={book.author}
          imageSrc={book.cover_image_path ?? undefined}
        />
      </button>

      {/* Dropdown moved OUTSIDE the button to fix invalid nested <button> */}
      <div className="absolute right-1 top-1 z-10 opacity-0 transition group-hover:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cream/90 backdrop-blur focus:outline-none focus:ring-2 focus:ring-accent-gold"
            aria-label="More actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onEdit(book)}>Edit metadata</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-0.5 px-1">
        <div className="line-clamp-2 font-serif text-sm leading-tight text-ink">{book.title}</div>
        {book.author && <div className="text-xs text-ink-muted">{book.author}</div>}
      </div>
    </div>
  );
}

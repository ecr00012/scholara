import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getProgress } from '../../lib/positionProgress';
import { useAppStore } from '../../store';
import type { Book } from '../../db/types';
import { GeneratedCover } from './GeneratedCover';

interface Props {
  book: Book;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
}

export function BookTile({ book, onEdit, onDelete }: Props) {
  const openBook = useAppStore((s) => s.openBook);
  const progress = getProgress(book.current_position);

  return (
    <div className="group relative flex flex-col gap-2">
      {/* Main clickable area */}
      <button
        type="button"
        className="relative aspect-[2/3] w-full overflow-hidden rounded-md transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-accent-gold"
        onClick={() => {
          void openBook(book.id);
        }}
        aria-label={`Open ${book.title}`}
      >
        <GeneratedCover
          title={book.title}
          author={book.author}
          imageSrc={book.cover_image_path ?? undefined}
          progress={progress}
        />
      </button>

      {/* Dropdown moved OUTSIDE the button to fix HTML nesting & overflow clipping */}
      <div className="absolute right-1 top-1 z-10 opacity-0 transition group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cream/90 backdrop-blur focus:outline-none focus:ring-2 focus:ring-accent-gold"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="border border-accent-amber/40 bg-cream text-ink"
          >
            <DropdownMenuItem
              className="cursor-pointer text-ink focus:bg-accent-amber/20 focus:text-ink"
              onClick={() => onEdit(book)}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-ink focus:bg-accent-amber/20 focus:text-ink "
              onClick={() => onDelete(book)}
            >
              Delete
            </DropdownMenuItem>
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

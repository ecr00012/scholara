import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { downloadGutenbergEpub } from '../../../ipc/gutenberg';
import { useAppStore } from '../../../store';
import { GeneratedCover } from '../GeneratedCover';
import type { GutenbergBook } from './types';

interface Props {
  book: GutenbergBook | null;
  onClose: () => void;
}

function formatIssued(issued: string | null): string {
  if (!issued) return '—';
  const d = new Date(issued);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-stone-200 px-2 py-0.5 text-xs text-ink">
      {children}
    </span>
  );
}

export function DetailModal({ book, onClose }: Props) {
  const insertBook = useAppStore((s) => s.insertBook);
  const [adding, setAdding] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setAdding(false);
    setImgError(false);
  }, [book?.id]);

  if (!book) return null;

  const author = book.authors.map((a) => a.name).join(', ') || 'Unknown';
  const primaryAuthor = book.authors[0]?.name ?? null;

  const handleAdd = async () => {
    setAdding(true);
    try {
      const result = await downloadGutenbergEpub(book.id);
      const inserted = await insertBook({
        title: book.title,
        file_path: result.storedPath,
        file_type: 'epub',
      });
      if (primaryAuthor) {
        await useAppStore.getState().updateBookMetadata(inserted.id, {
          title: inserted.title,
          author: primaryAuthor,
        });
      }
      toast.success(`Added "${book.title}" to your library.`);
      setTimeout(onClose, 600);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const reason = raw.includes(':') ? raw.split(':', 2)[1].trim() : raw;
      toast.error(`Could not download "${book.title}": ${reason}`);
      setAdding(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="h-[75vh] w-[75vw] max-w-[1100px] overflow-hidden border border-accent-amber/40 bg-cream p-0 text-ink ring-0">
        <DialogTitle className="sr-only">{book.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Book details for {book.title} by {author}
        </DialogDescription>
        <div className="grid h-full grid-cols-[40%_60%]">
          <div className="flex items-center justify-center bg-stone-100 p-8">
            {!imgError && book.cover_image ? (
              <img
                src={book.cover_image}
                alt=""
                className="max-h-full max-w-full object-contain"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="aspect-[2/3] max-h-full w-full max-w-[18rem]">
                <GeneratedCover title={book.title} author={primaryAuthor} />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto p-8">
            <h2 className="font-serif text-3xl text-ink">{book.title}</h2>
            <p className="text-base text-ink-muted">{author}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-muted">Released</dt>
              <dd>{formatIssued(book.issued)}</dd>
              <dt className="text-ink-muted">Publisher</dt>
              <dd>Project Gutenberg</dd>
              {book.reading_ease_score && (
                <>
                  <dt className="text-ink-muted">Reading ease</dt>
                  <dd>{book.reading_ease_score}</dd>
                </>
              )}
              <dt className="text-ink-muted">Downloads</dt>
              <dd>{book.download_count.toLocaleString()}</dd>
            </dl>
            {book.subjects.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-muted">
                  Subjects
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {book.subjects.map((subject) => (
                    <Pill key={subject}>{subject}</Pill>
                  ))}
                </div>
              </div>
            )}
            {book.bookshelves.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-muted">
                  Bookshelves
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {book.bookshelves.map((shelf) => (
                    <Pill key={shelf}>{shelf}</Pill>
                  ))}
                </div>
              </div>
            )}
            <div className="flex-1" />
            <div className="flex justify-end">
              <Button onClick={handleAdd} disabled={adding}>
                {adding ? 'Adding…' : 'Add to library'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

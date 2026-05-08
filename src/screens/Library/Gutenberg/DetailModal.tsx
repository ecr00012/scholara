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

function formatIssued(issued: string | null): string | null {
  if (!issued) return null;
  const d = new Date(issued);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-accent-amber/30 bg-accent-amber/5 px-3 py-1 text-xs leading-snug text-ink">
      {children}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-24 shrink-0 text-ink-muted">{label}</span>
      <span className="text-ink/40">·</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}

export function DetailModal({ book, onClose }: Props) {
  const insertBook = useAppStore((s) => s.insertBook);
  const runMetadataExtractionPass = useAppStore(
    (s) => s.runMetadataExtractionPass,
  );
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
      await insertBook({
        title: book.title,
        file_path: result.storedPath,
        file_type: 'epub',
      });
      await runMetadataExtractionPass();
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
      <DialogContent className="h-[80vh] w-[92vw] max-w-[92vw] sm:max-w-[1600px] overflow-hidden border border-accent-amber/40 bg-cream p-0 text-ink ring-0">
        <DialogTitle className="sr-only">{book.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Book details for {book.title} by {author}
        </DialogDescription>
        <div className="grid h-full grid-cols-[45%_55%] grid-rows-1">
          <div className="grid h-full min-h-0 place-items-center overflow-hidden border-r border-accent-amber/30 p-4">
            {!imgError && book.cover_image ? (
              <img
                src={book.cover_image}
                alt=""
                className="block h-3/4 w-auto max-w-[75%] rounded-md object-contain shadow-[0_8px_24px_-12px_rgba(180,120,40,0.35)] ring-1 ring-accent-amber/20"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="aspect-[2/3] h-3/4 max-h-[75%] overflow-hidden rounded-md shadow-[0_8px_24px_-12px_rgba(180,120,40,0.35)] ring-1 ring-accent-amber/20">
                <GeneratedCover title={book.title} author={primaryAuthor} />
              </div>
            )}
          </div>
          <div className="flex h-full min-h-0 min-w-0 flex-col gap-5 overflow-y-auto p-8">
            <div className="border-b border-accent-amber/30 pb-4">
              <h2 className="font-serif text-3xl text-ink">{book.title}</h2>
              <p className="mt-1 text-base italic text-ink-muted">{author}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <MetaRow label="Released" value={formatIssued(book.issued)} />
              <MetaRow label="Publisher" value="Project Gutenberg" />
              <MetaRow label="Reading ease" value={book.reading_ease_score} />
              <MetaRow
                label="Downloads"
                value={book.download_count.toLocaleString()}
              />
            </div>
            {book.subjects.length > 0 && (
              <div className="border-t border-accent-amber/20 pt-4">
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
              <div className="border-t border-accent-amber/20 pt-4">
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
            <div className="mt-auto flex justify-end border-t border-accent-amber/20 pt-4">
              <Button
                onClick={handleAdd}
                disabled={adding}
                className="h-11 px-6 text-base"
              >
                {adding ? 'Adding…' : 'Add to library'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';
import type { Book } from '../../db/types';

interface Props {
  book: Book | null;
  open: boolean;
  onClose: () => void;
}

export function DeleteBookDialog({ book, open, onClose }: Props) {
  const deleteBook = useAppStore((s) => s.deleteBook);

  if (!book) return null;

  const handleDelete = async () => {
    try {
      await deleteBook(book.id);
      toast.success('Deleted.');
      onClose();
    } catch (err) {
      toast.error(`Could not delete: ${(err as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border border-accent-amber/40 bg-cream text-ink ring-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete book</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{book.title}&rdquo;? This removes the file and any
            notes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 bg-cream">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

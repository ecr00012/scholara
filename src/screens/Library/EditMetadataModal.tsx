import { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppStore } from '../../store';
import type { Book } from '../../db/types';

interface Props {
  book: Book | null;
  open: boolean;
  onClose: () => void;
}

export function EditMetadataModal({ book, open, onClose }: Props) {
  const updateBookMetadata = useAppStore((s) => s.updateBookMetadata);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

  useEffect(() => {
    if (book) {
      setTitle(book.title);
      setAuthor(book.author ?? '');
    }
  }, [book]);

  if (!book) return null;

  const handleSave = async () => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      toast.error('Title cannot be empty.');
      return;
    }
    try {
      await updateBookMetadata(book.id, {
        title: trimmed,
        author: author.trim() === '' ? null : author.trim(),
      });
      toast.success('Updated.');
      onClose();
    } catch (err) {
      toast.error(`Could not save changes: ${(err as Error).message}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border border-accent-amber/40 bg-cream text-ink ring-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit metadata</DialogTitle>
          <DialogDescription>
            Update the title and author for this book.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="emm-title">Title</Label>
            <Input
              id="emm-title"
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="emm-author">Author</Label>
            <Input
              id="emm-author"
              value={author}
              maxLength={300}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 border-t-accent-amber/40 bg-cream">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

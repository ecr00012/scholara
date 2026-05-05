import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useAppStore } from '../../store';
import { copyUploadedFile } from '../../ipc/files';
import { titleFromFilename } from '../../lib/titleCase';
import type { Book } from '../../db/types';
import { Header } from './Header';
import { ApiKeyBanner } from './ApiKeyBanner';
import { BookGrid } from './BookGrid';
import { BrainPlaceholder } from './BrainPlaceholder';
import { ScrollStripPlaceholder } from './ScrollStripPlaceholder';
import { EditMetadataModal } from './EditMetadataModal';
import { DeleteBookDialog } from './DeleteBookDialog';

export function LibraryScreen() {
  const books = useAppStore((s) => s.books);
  const insertBook = useAppStore((s) => s.insertBook);
  const [editing, setEditing] = useState<Book | null>(null);
  const [deleting, setDeleting] = useState<Book | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const setup = async () => {
      unlisten = await listen<{ paths: string[] }>(
        'tauri://drag-drop',
        async (event) => {
          const paths = event.payload.paths.filter((p) =>
            /\.(pdf|epub)$/i.test(p),
          );
          if (paths.length === 0) {
            toast.error('Only PDF and EPUB files are supported.');
            return;
          }
          for (const p of paths) {
            try {
              const { storedPath, fileType } = await copyUploadedFile(p);
              const title = titleFromFilename(p);
              const book = await insertBook({
                title,
                file_path: storedPath,
                file_type: fileType,
              });
              toast.success(`Added "${book.title}"`, {
                action: { label: 'Edit', onClick: () => setEditing(book) },
              });
            } catch (err) {
              toast.error(
                `Could not save dropped file: ${(err as Error).message}`,
              );
            }
          }
        },
      );
    };
    void setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, [insertBook]);

  return (
    <div className="grid h-full grid-cols-[1fr_20rem]">
      <main className="flex flex-col gap-6 overflow-y-auto px-12 py-8">
        <ApiKeyBanner />
        <Header />
        <BookGrid
          books={books}
          onEdit={setEditing}
          onDelete={setDeleting}
          onAdded={setEditing}
        />
      </main>
      <aside className="flex flex-col gap-4 border-l border-stone-200 p-6">
        <BrainPlaceholder />
        <ScrollStripPlaceholder />
      </aside>
      <EditMetadataModal
        book={editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <DeleteBookDialog
        book={deleting}
        open={deleting !== null}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

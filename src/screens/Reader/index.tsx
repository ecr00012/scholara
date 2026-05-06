import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { readBookBytes } from '../../ipc/files';
import { AgentDisplay } from './AgentDisplay';
import { DictionaryModal } from './DictionaryModal';
import { FullReaderDisplay } from './FullReaderDisplay';
import { MissingFileScreen } from './MissingFileScreen';
import { NotePeek } from './NotePeek';
import { SelectionToolbar } from './SelectionToolbar';

export function ReaderScreen() {
  const currentBookId = useAppStore((s) => s.currentBookId);
  const books = useAppStore((s) => s.books);
  const book = useMemo(
    () => books.find((candidate) => candidate.id === currentBookId) ?? null,
    [books, currentBookId],
  );

  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [missing, setMissing] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    if (!book) {
      setMissing(true);
      return;
    }

    setMissing(false);
    setBytes(null);

    void (async () => {
      try {
        const nextBytes = await readBookBytes(book.file_path);
        if (!cancelled.current) {
          setBytes(nextBytes);
        }
      } catch (error) {
        console.warn('Could not read book bytes:', error);
        if (!cancelled.current) {
          setMissing(true);
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [book?.id, book?.file_path]);

  if (!book || missing) {
    return <MissingFileScreen />;
  }

  if (!bytes) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cream">
        <p className="text-sm text-ink-muted">Opening…</p>
      </div>
    );
  }

  return (
    <>
      {book.display_mode === 'reader' ? (
        <FullReaderDisplay book={book} bytes={bytes} />
      ) : (
        <AgentDisplay book={book} bytes={bytes} />
      )}
      <SelectionToolbar book={book} />
      <NotePeek />
      <DictionaryModal />
    </>
  );
}

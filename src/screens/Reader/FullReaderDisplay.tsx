import type { Book } from '../../db/types';
import { useAppStore } from '../../store';
import { ReaderChrome } from './ReaderChrome';
import { ReaderLeaf } from './ReaderLeaf';
import { NotesModeInput } from './NotesModeInput';
import { FloatingLogoInput } from './FloatingLogoInput';

interface Props {
  book: Book;
  bytes: ArrayBuffer;
}

export function FullReaderDisplay({ book, bytes }: Props) {
  const notesModeActive = useAppStore((s) => s.notesModeActive);

  return (
    <div className="relative flex h-full w-full flex-col">
      <ReaderChrome book={book} variant="fullscreen" />
      <div className="relative min-h-0 flex-1">
        <ReaderLeaf book={book} bytes={bytes} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <div className="pointer-events-auto">
          {notesModeActive ? (
            <NotesModeInput book={book} fullWidth />
          ) : (
            <FloatingLogoInput />
          )}
        </div>
      </div>
    </div>
  );
}

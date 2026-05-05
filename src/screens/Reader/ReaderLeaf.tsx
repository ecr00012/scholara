import type { Book } from '../../db/types';
import { EpubReader } from './EpubReader';
import { PdfReader } from './PdfReader';

interface Props {
  book: Book;
  bytes: ArrayBuffer;
}

export function ReaderLeaf({ book, bytes }: Props) {
  return book.file_type === 'epub' ? (
    <EpubReader book={book} bytes={bytes} />
  ) : (
    <PdfReader book={book} bytes={bytes} />
  );
}

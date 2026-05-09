import type { Book } from '../../../db/types';
import { AiChatRoot } from './chat/AiChatRoot';

interface Props {
  book: Book;
}

export function AiChatTab({ book }: Props) {
  return <AiChatRoot book={book} />;
}

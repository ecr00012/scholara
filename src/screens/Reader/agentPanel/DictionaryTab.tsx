import { Trash2 } from 'lucide-react';
import type { Book } from '../../../db/types';
import { useAppStore } from '../../../store';

interface Props {
  book: Book;
}

export function DictionaryTab({ book: _book }: Props) {
  const vocabulary = useAppStore((state) => state.currentBookVocab);
  const deleteVocabulary = useAppStore((state) => state.deleteVocabulary);

  if (vocabulary.length === 0) {
    return <p className="text-sm text-ink-muted">No saved words yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {vocabulary.map((entry) => (
        <li key={entry.id} className="rounded-2xl border border-stone-200 bg-cream p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-serif text-base text-ink">{entry.word}</p>
            <button
              type="button"
              aria-label="Delete word"
              onClick={() => {
                void deleteVocabulary(entry.id);
              }}
              className="rounded-full p-1 transition hover:bg-stone-100 hover:text-ink"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-1 text-sm text-ink/80">{entry.definition}</p>
        </li>
      ))}
    </ul>
  );
}

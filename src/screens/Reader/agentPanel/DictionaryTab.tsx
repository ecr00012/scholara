import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Book } from '../../../db/types';
import { parseStoredDefinition } from '../../../dictionary/lookup';
import { useAppStore } from '../../../store';

interface Props {
  book: Book;
}

const COLLAPSED_SENSE_COUNT = 2;
const COLLAPSED_CHAR_COUNT = 220;

export function DictionaryTab({ book: _book }: Props) {
  const vocabulary = useAppStore((state) => state.currentBookVocab);
  const deleteVocabulary = useAppStore((state) => state.deleteVocabulary);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  if (vocabulary.length === 0) {
    return <p className="text-sm text-ink-muted">No saved words yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {vocabulary.map((entry) => {
        const senses = parseStoredDefinition(entry.definition);
        const isExpanded = expanded.has(entry.id);
        const visibleSenses = isExpanded
          ? senses
          : clampDefinitionSenses(senses);
        const canTruncate =
          clampDefinitionSenses(senses).length < senses.length ||
          clampDefinitionSenses(senses).some(
            (sense, index) => sense.gloss !== senses[index]?.gloss,
          );

        return (
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
            <ul className="mt-2 flex flex-col gap-1.5">
              {visibleSenses.map((sense, index) => (
                <li key={index} className="text-sm leading-6 text-ink/80">
                  {sense.pos ? (
                    <span className="font-serif italic text-accent-orange">
                      {sense.pos} ·{' '}
                    </span>
                  ) : null}
                  {sense.gloss}
                </li>
              ))}
            </ul>
            {canTruncate ? (
              <button
                type="button"
                onClick={() => {
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(entry.id)) next.delete(entry.id);
                    else next.add(entry.id);
                    return next;
                  });
                }}
                className="mt-2 text-xs font-medium text-accent-orange transition hover:text-ink"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function clampDefinitionSenses(
  senses: ReturnType<typeof parseStoredDefinition>,
): ReturnType<typeof parseStoredDefinition> {
  let remaining = COLLAPSED_CHAR_COUNT;
  const visible = senses.slice(0, COLLAPSED_SENSE_COUNT).map((sense) => {
    if (remaining <= 0) return { ...sense, gloss: '' };
    if (sense.gloss.length <= remaining) {
      remaining -= sense.gloss.length;
      return sense;
    }
    const gloss = `${sense.gloss.slice(0, Math.max(0, remaining)).trimEnd()}…`;
    remaining = 0;
    return { ...sense, gloss };
  });

  return visible.filter((sense) => sense.gloss);
}

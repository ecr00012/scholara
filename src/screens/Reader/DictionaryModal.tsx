import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  DefinitionNotFoundError,
  formatSensesForStorage,
  lookupWord,
  OfflineDictionaryError,
  type DefinitionResult,
} from '../../dictionary/lookup';
import { useAppStore } from '../../store';

const OPEN_EVENT = 'scholara:open-dictionary';

export function dispatchOpenDictionary(word: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: word }));
}

type ModalState =
  | { kind: 'idle' }
  | { kind: 'loading'; word: string }
  | { kind: 'done'; word: string; result: DefinitionResult }
  | { kind: 'closing' };

export function DictionaryModal() {
  const currentBookId = useAppStore((state) => state.currentBookId);
  const insertVocab = useAppStore((state) => state.insertVocabForCurrentBook);
  const [state, setState] = useState<ModalState>({ kind: 'idle' });

  useEffect(() => {
    let activeWord: string | null = null;

    const handleOpen = (event: Event) => {
      const word = (event as CustomEvent<string>).detail;
      if (!currentBookId) return;

      activeWord = word;
      setState({ kind: 'loading', word });

      void (async () => {
        try {
          const result = await lookupWord(word);
          if (activeWord !== word) return;
          setState({ kind: 'done', word, result });

          try {
            await insertVocab({
              word,
              definition: formatSensesForStorage(result.senses),
            });
          } catch (error) {
            console.warn('Could not save dictionary entry:', error);
            toast.error('Could not save to dictionary.');
          }
        } catch (error) {
          if (activeWord !== word) return;
          if (error instanceof OfflineDictionaryError) {
            toast.error(error.message);
          } else if (error instanceof DefinitionNotFoundError) {
            toast.error(error.message);
          } else {
            console.error(error);
            toast.error('Could not look up that word.');
          }
          setState({ kind: 'closing' });
        }
      })();
    };

    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_EVENT, handleOpen);
    };
  }, [currentBookId, insertVocab]);

  useEffect(() => {
    if (state.kind !== 'closing') return;
    const timeoutId = window.setTimeout(() => setState({ kind: 'idle' }), 250);
    return () => window.clearTimeout(timeoutId);
  }, [state.kind]);

  function dismiss() {
    setState({ kind: 'idle' });
  }

  const visible = state.kind === 'loading' || state.kind === 'done';
  const word =
    state.kind === 'loading' || state.kind === 'done' ? state.word : '';

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="dictionary-modal"
          role="dialog"
          aria-label="Dictionary"
          className="fixed left-1/2 top-8 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-3xl border border-amber-100 bg-white/75 p-6 shadow-xl backdrop-blur-md"
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          onClick={dismiss}
        >
          <p className="font-serif text-[22px] text-ink">{word}</p>
          <div className="my-3 h-px bg-stone-200" />
          {state.kind === 'loading' ? (
            <p className="text-base leading-7 text-ink-muted">
              Looking up<span className="animate-pulse">…</span>
            </p>
          ) : state.kind === 'done' ? (
            <ul className="flex flex-col gap-2">
              {state.result.senses.map((sense, idx) => (
                <li key={idx} className="text-base leading-7 text-ink/80">
                  {sense.pos ? (
                    <span className="font-serif italic text-ink-muted">{sense.pos} · </span>
                  ) : null}
                  {sense.gloss}
                </li>
              ))}
            </ul>
          ) : null}
          {state.kind === 'done' && state.result.source === 'wiktionary' ? (
            <p className="mt-3 text-xs uppercase tracking-wide text-ink-muted">
              via Wiktionary
            </p>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

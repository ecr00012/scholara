import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { streamWordDefinition, type DefinitionStream } from '../../llm/dictionary';
import { useAppStore } from '../../store';

const OPEN_EVENT = 'scholara:open-dictionary';

export function dispatchOpenDictionary(word: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: word }));
}

type ModalState =
  | { kind: 'idle' }
  | { kind: 'streaming'; word: string; partial: string }
  | { kind: 'done'; word: string; full: string }
  | { kind: 'aborted' };

export function DictionaryModal() {
  const currentBookId = useAppStore((state) => state.currentBookId);
  const insertVocab = useAppStore((state) => state.insertVocabForCurrentBook);
  const [state, setState] = useState<ModalState>({ kind: 'idle' });
  const streamRef = useRef<DefinitionStream | null>(null);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const word = (event as CustomEvent<string>).detail;
      if (!currentBookId) return;

      streamRef.current?.abort();
      const stream = streamWordDefinition(word);
      streamRef.current = stream;
      setState({ kind: 'streaming', word, partial: '' });

      void (async () => {
        try {
          for await (const token of stream.tokens) {
            setState((current) =>
              current.kind === 'streaming' && current.word === word
                ? { ...current, partial: current.partial + token }
                : current,
            );
          }

          const full = await stream.done;
          setState({ kind: 'done', word, full });

          try {
            await insertVocab({ word, definition: full });
          } catch (error) {
            console.warn('Could not save dictionary entry:', error);
            toast.error('Could not save to dictionary.');
          }
        } catch (error) {
          if ((error as Error).message !== 'aborted') {
            console.error(error);
          }
          setState({ kind: 'aborted' });
        }
      })();
    };

    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, [currentBookId, insertVocab]);

  useEffect(() => {
    if (state.kind !== 'aborted' && state.kind !== 'done') return;

    const timeoutId = window.setTimeout(() => {
      setState({ kind: 'idle' });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [state.kind]);

  function dismiss() {
    if (state.kind === 'streaming') {
      streamRef.current?.abort();
      setState({ kind: 'aborted' });
      return;
    }

    setState({ kind: 'idle' });
  }

  const visible = state.kind === 'streaming' || state.kind === 'done';

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
          <p className="font-serif text-[22px] text-ink">
            {state.word}
          </p>
          <div className="my-3 h-px bg-stone-200" />
          <p className="text-base leading-7 text-ink/80">
            {state.kind === 'streaming' ? state.partial : state.full}
            {state.kind === 'streaming' ? (
              <span className="animate-pulse text-ink-muted">▌</span>
            ) : null}
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

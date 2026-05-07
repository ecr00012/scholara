import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { dispatchReaderNavigation } from './readerSupport';

interface Props {
  disabled: boolean;
}

export function ReaderSearchPopover({ disabled }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const query = useAppStore((state) => state.readerSearchQuery);
  const results = useAppStore((state) => state.readerSearchResults);
  const status = useAppStore((state) => state.readerSearchStatus);
  const setQuery = useAppStore((state) => state.setReaderSearchQuery);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={
          disabled ? 'Book search is available for EPUB books' : 'Search this book'
        }
        title={
          disabled ? 'Book search is available for EPUB books' : 'Search this book'
        }
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-stone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Search className="h-4 w-4" />
      </button>
      {open && !disabled ? (
        <div
          ref={panelRef}
          className="absolute right-0 top-10 z-40 w-96 rounded-2xl border border-white/40 bg-white/55 p-3 shadow-xl backdrop-blur-md"
        >
          <div className="flex h-11 items-center rounded-full border border-white/40 bg-white/50 px-4">
            <Search className="mr-2 h-4 w-4 text-ink-muted" />
            <input
              ref={inputRef}
              value={query}
              placeholder="Search this book..."
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                }
              }}
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
          </div>
          {query.trim() ? (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/40 bg-cream/80">
              {status === 'indexing' ? (
                <p className="px-3 py-3 text-sm text-ink-muted">
                  Indexing...
                </p>
              ) : results.length === 0 ? (
                <p className="px-3 py-3 text-sm text-ink-muted">No matches.</p>
              ) : (
                results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="block w-full border-b border-stone-200 px-3 py-2 text-left last:border-b-0 hover:bg-white/70"
                    onClick={() => {
                      dispatchReaderNavigation(result.position);
                      setOpen(false);
                    }}
                  >
                    <span className="block text-xs font-medium text-ink-muted">
                      {result.label}
                    </span>
                    <span className="line-clamp-2 text-sm leading-5 text-ink">
                      {result.snippet}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

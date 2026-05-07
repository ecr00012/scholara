import { Check, Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { dispatchReaderNavigation } from './readerSupport';

interface Props {
  disabled: boolean;
}

export function ChapterIndexPopover({ disabled }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const items = useAppStore((state) => state.readerNavItems);

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
          disabled ? 'Chapter index is available for EPUB books' : 'Open contents'
        }
        title={
          disabled ? 'Chapter index is available for EPUB books' : 'Open contents'
        }
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-stone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Menu className="h-4 w-4" />
      </button>
      {open && !disabled ? (
        <div
          ref={panelRef}
          className="absolute left-0 top-10 z-40 w-72 overflow-hidden rounded-lg border border-stone-200 bg-cream shadow-xl"
        >
          <div className="border-b border-stone-200 px-3 py-2 text-sm font-medium text-ink">
            Contents
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            {items.length === 0 ? (
              <p className="px-3 py-3 text-sm text-ink-muted">
                Contents loading...
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition hover:bg-white"
                  style={{ paddingLeft: `${12 + (item.level ?? 0) * 12}px` }}
                  onClick={() => {
                    dispatchReaderNavigation(item.position);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.progress !== undefined ? (
                    <span className="text-xs text-ink-muted">
                      {Math.round(item.progress * 100)}%
                    </span>
                  ) : null}
                  {item.kind === 'cover' ? (
                    <Check className="h-3.5 w-3.5 text-accent-orange" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

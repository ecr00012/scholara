import { Type } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '../../store';
import type { ReaderPreferences } from './readerSupport';

const FONT_OPTIONS: Array<{
  value: ReaderPreferences['fontFamily'];
  label: string;
}> = [
  { value: 'original', label: 'Original' },
  { value: 'arial', label: 'Arial' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'iowan', label: 'Iowan' },
];

interface Props {
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TextPreferencesDialog({
  disabled,
  open,
  onOpenChange,
}: Props) {
  const preferences = useAppStore((state) => state.readerPreferences);
  const setReaderPreferences = useAppStore(
    (state) => state.setReaderPreferences,
  );

  const update = (patch: Partial<ReaderPreferences>) => {
    setReaderPreferences({ ...preferences, ...patch });
  };

  return (
    <>
      <button
        type="button"
        aria-label={
          disabled
            ? 'Text preferences are available for EPUB books'
            : 'Reading text preferences'
        }
        title={
          disabled
            ? 'Text preferences are available for EPUB books'
            : 'Reading text preferences'
        }
        disabled={disabled}
        onClick={() => onOpenChange(true)}
        className="flex size-8 items-center justify-center rounded-md text-ink-muted transition hover:bg-stone-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Type className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-80 rounded-lg bg-cream p-4">
          <DialogHeader>
            <DialogTitle className="font-serif text-lg text-ink">
              Reading Text
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Size</p>
              <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-white/70 px-3 py-2">
                <button
                  type="button"
                  aria-label="Decrease text size"
                  className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-stone-100 hover:text-ink"
                  onClick={() =>
                    update({
                      fontScale: Math.max(85, preferences.fontScale - 5),
                    })
                  }
                >
                  A-
                </button>
                <span className="text-sm text-ink">
                  {preferences.fontScale}%
                </span>
                <button
                  type="button"
                  aria-label="Increase text size"
                  className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-stone-100 hover:text-ink"
                  onClick={() =>
                    update({
                      fontScale: Math.min(130, preferences.fontScale + 5),
                    })
                  }
                >
                  A+
                </button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Font</p>
              <div className="grid grid-cols-2 gap-2">
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={preferences.fontFamily === option.value}
                    onClick={() => update({ fontFamily: option.value })}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      preferences.fontFamily === option.value
                        ? 'border-accent-orange bg-accent-orange/10 text-accent-orange'
                        : 'border-stone-200 bg-white/70 text-ink-muted hover:text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

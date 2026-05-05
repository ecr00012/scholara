import { BookOpen, Columns2 } from 'lucide-react';
import type { DisplayMode } from '../../db/types';

interface Props {
  value: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

export function ModeToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-stone-300">
      <button
        type="button"
        aria-label="Agent display"
        aria-pressed={value === 'agent'}
        onClick={() => onChange('agent')}
        className={`px-3 py-1 ${
          value === 'agent'
            ? 'bg-stone-200 text-ink'
            : 'bg-cream text-ink-muted'
        }`}
      >
        <Columns2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Full reader display"
        aria-pressed={value === 'reader'}
        onClick={() => onChange('reader')}
        className={`px-3 py-1 ${
          value === 'reader'
            ? 'bg-stone-200 text-ink'
            : 'bg-cream text-ink-muted'
        }`}
      >
        <BookOpen className="h-4 w-4" />
      </button>
    </div>
  );
}

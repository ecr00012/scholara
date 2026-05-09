import { Shield, ShieldCheck } from 'lucide-react';
import type { ThreadSpoilerMode } from '../../../../db/types';

interface Props {
  mode: ThreadSpoilerMode;
  positionLabel: string;
  onChange: (mode: ThreadSpoilerMode) => void;
}

export function SpoilerToggle({ mode, positionLabel, onChange }: Props) {
  const on = mode === 1;
  return (
    <button
      type="button"
      title={on ? `No spoilers — agent stays at or before ${positionLabel || 'your current page'}` : 'Spoilers allowed — full book access'}
      aria-label="Toggle spoiler mode"
      aria-pressed={on}
      onClick={() => onChange(on ? 0 : 1)}
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-stone-100"
    >
      {on ? <ShieldCheck className="h-4 w-4 text-accent-orange" /> : <Shield className="h-4 w-4" />}
    </button>
  );
}

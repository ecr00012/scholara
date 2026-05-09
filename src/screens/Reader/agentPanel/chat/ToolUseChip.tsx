import { useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';

interface Passage {
  position_marker?: string;
  text: string;
  score?: number;
}

interface Props {
  toolName: string;
  resultsJson: string;
  isError: boolean;
  onJump?: (positionMarker: string) => void;
}

export function ToolUseChip({ toolName, resultsJson, isError, onJump }: Props) {
  const [open, setOpen] = useState(false);
  let parsed: Passage[] = [];
  if (!isError) {
    try { parsed = JSON.parse(resultsJson) as Passage[]; } catch { /* empty */ }
  }
  const label = isError
    ? `↳ ${toolName} errored`
    : `↳ ${toolName.replace('_', ' ')} · ${parsed.length} ${parsed.length === 1 ? 'result' : 'results'}`;

  return (
    <div className="my-1 rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 text-left text-ink-muted hover:text-ink"
      >
        <ChevronRight className={`h-3 w-3 transition ${open ? 'rotate-90' : ''}`} />
        <Search className="h-3 w-3" />
        <span>{label}</span>
      </button>
      {open && parsed.length > 0 && (
        <ul className="mt-1 space-y-1 border-t border-stone-200 pt-1">
          {parsed.map((p, i) => (
            <li key={i} className="text-ink-muted">
              <button
                type="button"
                disabled={!p.position_marker || !onJump}
                onClick={() => p.position_marker && onJump?.(p.position_marker)}
                className="font-mono text-[10px] uppercase text-accent-orange disabled:opacity-50"
              >
                {p.position_marker ?? '—'}
              </button>{' '}
              <span className="text-ink">{p.text.length > 280 ? p.text.slice(0, 280) + '…' : p.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

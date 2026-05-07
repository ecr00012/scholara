import { BookOpen } from 'lucide-react';

export function OfflineState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
      <BookOpen className="h-8 w-8 text-ink-muted" aria-hidden="true" />
      <p className="text-center text-xs text-ink-muted">
        Connect to the internet to access Project Gutenberg.
      </p>
    </div>
  );
}

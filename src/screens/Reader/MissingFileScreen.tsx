import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';

export function MissingFileScreen() {
  const closeBook = useAppStore((s) => s.closeBook);

  return (
    <div className="flex h-full w-full items-center justify-center bg-cream">
      <div className="flex flex-col items-center gap-6 text-center">
        <p className="font-serif text-xl text-ink">
          This book&apos;s file is missing.
        </p>
        <p className="text-sm text-ink-muted">It may have been moved or deleted.</p>
        <Button variant="outline" onClick={closeBook}>
          ← Library
        </Button>
      </div>
    </div>
  );
}

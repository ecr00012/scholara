import { Button } from '@/components/ui/button';

interface Props {
  onRetry: () => void;
}

export function ApiErrorState({ onRetry }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6">
      <p className="text-center text-xs text-ink-muted">
        Couldn't reach the Project Gutenberg API.
      </p>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

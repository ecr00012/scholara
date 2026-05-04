import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { appDataDirPath, revealInFileManager } from '../../ipc/files';
import { revealLabel } from '../../lib/platform';

export function DataLocationPanel() {
  const [path, setPath] = useState<string>('');

  useEffect(() => {
    appDataDirPath()
      .then(setPath)
      .catch((err) => toast.error(`Could not read data path: ${(err as Error).message}`));
  }, []);

  const handleReveal = async () => {
    if (!path) return;
    try {
      await revealInFileManager(path);
    } catch (err) {
      toast.error(`Could not reveal: ${(err as Error).message}`);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Your Library
      </h2>
      <p className="text-sm text-ink-muted">
        Your books and notes are stored locally at:
      </p>
      <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-sm text-ink select-all">
        {path || 'Loading…'}
      </div>
      <Button variant="outline" onClick={handleReveal} disabled={!path}>
        {revealLabel()}
      </Button>
    </section>
  );
}

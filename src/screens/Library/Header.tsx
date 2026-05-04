import { Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';

export function Header() {
  const setView = useAppStore((s) => s.setView);
  return (
    <header className="flex items-baseline justify-between border-b border-stone-200 pb-4">
      <h1 className="font-serif text-3xl tracking-tight text-ink">Scholara</h1>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Settings"
        onClick={() => setView('settings')}
      >
        <SettingsIcon className="h-5 w-5" />
      </Button>
    </header>
  );
}

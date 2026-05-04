import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';
import { ApiKeyForm } from './ApiKeyForm';
import { DataLocationPanel } from './DataLocationPanel';

export function SettingsScreen() {
  const setView = useAppStore((s) => s.setView);
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-8 overflow-y-auto px-12 py-8">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={() => setView('library')}
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Library
      </Button>
      <h1 className="font-serif text-3xl tracking-tight text-ink">Settings</h1>
      <hr className="border-stone-200" />
      <ApiKeyForm />
      <hr className="border-stone-200" />
      <DataLocationPanel />
    </div>
  );
}

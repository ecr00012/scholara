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
      <ApiKeyForm
        storeKey="apiKey"
        saveAction="saveApiKey"
        heading="Anthropic API Key"
        description="Used by the AI study mentor. Stored in your OS keychain; never written to disk by Scholara."
        placeholder="sk-ant-..."
        helpHref="https://console.anthropic.com"
        helpLabel="Get a key at console.anthropic.com →"
      />
      <hr className="border-stone-200" />
      <ApiKeyForm
        storeKey="gutenbergApiKey"
        saveAction="saveGutenbergApiKey"
        heading="Project Gutenberg API Key (RapidAPI)"
        description="Used to load the rotating Project Gutenberg panel on your library. Stored in your OS keychain; never written to disk by Scholara."
        placeholder="X-RapidAPI-Key value"
        helpHref="https://rapidapi.com/help-lQ_hVT8W5/api/project-gutenberg-free-books-api1"
        helpLabel="Get a key on RapidAPI →"
      />
      <hr className="border-stone-200" />
      <DataLocationPanel />
    </div>
  );
}

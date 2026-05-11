import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';
import { ApiKeyForm } from './ApiKeyForm';
import { DataLocationPanel } from './DataLocationPanel';
import { ModelPicker } from './ModelPicker';
import { PreferencesManager } from './PreferencesManager';
import { ReaderProfileViewer } from './ReaderProfileViewer';
import { ReembedAllButton } from './ReembedAllButton';
import { SecretDiagnosticPanel } from './SecretDiagnosticPanel';

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
        storeKey="openrouterApiKey"
        saveAction="saveOpenrouterApiKey"
        heading="OpenRouter API Key"
        description="Used by the AI study mentor. Stored in your OS keychain; never written to disk by Scholara. The free default model works without billing."
        placeholder="sk-or-v1-..."
        helpHref="https://openrouter.ai/keys"
        helpLabel="Get a key at openrouter.ai/keys →"
      />
      <hr className="border-stone-200" />
      <ModelPicker />
      <hr className="border-stone-200" />
      <PreferencesManager />
      <hr className="border-stone-200" />
      <ReaderProfileViewer />
      <hr className="border-stone-200" />
      <ReembedAllButton />
      {import.meta.env.DEV && (
        <>
          <hr className="border-stone-200" />
          <SecretDiagnosticPanel />
        </>
      )}
      <hr className="border-stone-200" />
      <DataLocationPanel />
    </div>
  );
}

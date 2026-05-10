import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { useAppStore } from './store';
import { LibraryScreen } from './screens/Library';
import { SettingsScreen } from './screens/Settings';
import { ReaderScreen } from './screens/Reader';

export default function App() {
  const view = useAppStore((s) => s.view);
  const loadBooks = useAppStore((s) => s.loadBooks);
  const loadOpenrouterApiKey = useAppStore((s) => s.loadOpenrouterApiKey);
  const loadGutenbergApiKey = useAppStore((s) => s.loadGutenbergApiKey);
  const runMetadataExtractionPass = useAppStore(
    (s) => s.runMetadataExtractionPass,
  );

  useEffect(() => {
    void (async () => {
      await Promise.all([loadOpenrouterApiKey(), loadGutenbergApiKey(), loadBooks()]);
      void runMetadataExtractionPass();
    })();
  }, [loadOpenrouterApiKey, loadBooks, loadGutenbergApiKey, runMetadataExtractionPass]);

  return (
    <>
      {view === 'library' && <LibraryScreen />}
      {view === 'settings' && <SettingsScreen />}
      {view === 'reader' && <ReaderScreen />}
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}

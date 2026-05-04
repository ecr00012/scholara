import { useEffect } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { useAppStore } from './store';
import { LibraryScreen } from './screens/Library';
import { SettingsScreen } from './screens/Settings';

export default function App() {
  const view = useAppStore((s) => s.view);
  const loadBooks = useAppStore((s) => s.loadBooks);
  const loadApiKey = useAppStore((s) => s.loadApiKey);

  useEffect(() => {
    void Promise.all([loadApiKey(), loadBooks()]);
  }, [loadApiKey, loadBooks]);

  return (
    <>
      {view === 'library' ? <LibraryScreen /> : <SettingsScreen />}
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}

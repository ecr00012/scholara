import { Button } from '@/components/ui/button';
import { useAppStore } from '../../store';

export function ApiKeyBanner() {
  const apiKey = useAppStore((s) => s.openrouterApiKey);
  const dismissed = useAppStore((s) => s.apiKeyBannerDismissed);
  const setView = useAppStore((s) => s.setView);
  const dismiss = useAppStore((s) => s.dismissApiKeyBanner);

  if (apiKey !== null || dismissed) return null;

  return (
    <div
      role="status"
      className="animate-banner-in flex items-center justify-between gap-4 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-4 py-2 text-sm text-ink"
    >
      <span>Add your OpenRouter API key to unlock the AI study mentor.</span>
      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => setView('settings')}
        >
          Set up
        </Button>
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Later
        </Button>
      </div>
    </div>
  );
}

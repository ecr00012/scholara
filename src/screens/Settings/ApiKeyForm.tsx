import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStore } from '../../store';

type StoreKey = 'openrouterApiKey' | 'gutenbergApiKey';
type SaveAction = 'saveOpenrouterApiKey' | 'saveGutenbergApiKey';

interface Props {
  storeKey: StoreKey;
  saveAction: SaveAction;
  heading: string;
  description: string;
  placeholder: string;
  helpHref: string;
  helpLabel: string;
}

export function ApiKeyForm({
  storeKey,
  saveAction,
  heading,
  description,
  placeholder,
  helpHref,
  helpLabel,
}: Props) {
  const apiKey = useAppStore((s) => s[storeKey]);
  const save = useAppStore((s) => s[saveAction]);
  const [revealed, setRevealed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const displayValue =
    draft !== null
      ? draft
      : revealed && apiKey !== null
        ? apiKey
        : apiKey
          ? '●●●●●●●●●●●●●●●●'
          : '';

  const handleShow = () => {
    setRevealed((r) => !r);
    if (draft === null && apiKey !== null) {
      setDraft(apiKey);
    }
  };

  const handleSave = async () => {
    const value = draft ?? '';
    try {
      await save(value);
      toast.success(value === '' ? 'API key cleared.' : 'API key saved.');
      setDraft(null);
      setRevealed(false);
    } catch (err) {
      toast.error(`Could not save API key: ${(err as Error).message}`);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        {heading}
      </h2>
      <p className="text-sm text-ink-muted">{description}</p>
      <div className="flex gap-2">
        <Input
          type={revealed ? 'text' : 'password'}
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="font-mono"
        />
        <Button variant="ghost" onClick={handleShow}>
          {revealed ? 'Hide' : 'Show'}
        </Button>
        <Button onClick={handleSave} disabled={draft === null}>
          Save
        </Button>
      </div>
      <a
        href={helpHref}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-accent-amber underline-offset-2 hover:underline"
      >
        {helpLabel}
      </a>
    </section>
  );
}

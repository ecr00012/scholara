import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { verifyKey } from '../../../lib/gutenbergApi';

type Variant = 'missing-key' | 'invalid-key';

interface Props {
  variant: Variant;
  onSaved: (key: string) => Promise<void>;
  keychainError?: string | null;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'invalid-key' }
  | { kind: 'offline' }
  | { kind: 'api-error' }
  | { kind: 'save-error' };

export function ApiKeyForm({ variant, onSaved, keychainError }: Props) {
  const [draft, setDraft] = useState('');
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });

  const handleSubmit = async () => {
    const key = draft.trim();
    if (key === '') return;
    setSubmit({ kind: 'verifying' });
    const result = await verifyKey(key);
    if (result.kind === 'ok') {
      try {
        await onSaved(key);
      } catch {
        setSubmit({ kind: 'save-error' });
      }
      return;
    }
    if (result.kind === 'invalid-key') {
      setSubmit({ kind: 'invalid-key' });
      return;
    }
    if (result.kind === 'offline') {
      setSubmit({ kind: 'offline' });
      return;
    }
    setSubmit({ kind: 'api-error' });
  };

  const message = (() => {
    if (submit.kind === 'invalid-key' || variant === 'invalid-key') {
      return 'Your saved key was rejected. Please re-enter.';
    }
    if (submit.kind === 'offline') {
      return 'No internet connection. Try again when you are online.';
    }
    if (submit.kind === 'api-error') {
      return "Couldn't reach the Project Gutenberg API.";
    }
    if (submit.kind === 'save-error') {
      return (
        keychainError ??
        'Could not save your Project Gutenberg API key to the system keychain.'
      );
    }
    if (keychainError) {
      return keychainError;
    }
    return null;
  })();

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <p className="text-xs text-ink-muted">
        Enter your RapidAPI key to load books from Project Gutenberg.
      </p>
      {message && <p className="text-xs text-accent-orange">{message}</p>}
      <Input
        type="password"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (submit.kind !== 'idle' && submit.kind !== 'verifying') {
            setSubmit({ kind: 'idle' });
          }
        }}
        placeholder="X-RapidAPI-Key value"
        className="font-mono text-xs"
        disabled={submit.kind === 'verifying'}
      />
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={draft.trim() === '' || submit.kind === 'verifying'}
      >
        {submit.kind === 'verifying' ? 'Verifying…' : 'Save'}
      </Button>
      <a
        href="https://rapidapi.com/help-lQ_hVT8W5/api/project-gutenberg-free-books-api1"
        target="_blank"
        rel="noreferrer"
        className="text-xs text-accent-amber underline-offset-2 hover:underline"
      >
        Get a free key from RapidAPI →
      </a>
    </div>
  );
}

import { useEffect, useState } from 'react';

const KEY = 'scholara_default_model';
const OPTIONS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (default, cheapest)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (deeper)' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7 (most capable)' },
];

export function ModelPicker() {
  const [model, setModel] = useState<string>(
    () => localStorage.getItem(KEY) || 'claude-haiku-4-5',
  );

  useEffect(() => {
    localStorage.setItem(KEY, model);
  }, [model]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">
        Default Model
      </h2>
      <p className="text-sm text-ink-muted">
        Used for new chats. Existing chats keep the model they were started with.
      </p>
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="block w-full rounded-md border border-stone-200 bg-white px-3 py-1.5 text-sm text-ink"
      >
        {OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </section>
  );
}

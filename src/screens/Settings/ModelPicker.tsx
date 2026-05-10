import { useEffect, useState } from 'react';
import { MODELS, DEFAULT_MODEL_ID } from '../../agent/models';

const KEY = 'scholara_default_model';

export function ModelPicker() {
  const [model, setModel] = useState<string>(
    () => localStorage.getItem(KEY) || DEFAULT_MODEL_ID,
  );

  useEffect(() => {
    localStorage.setItem(KEY, model);
  }, [model]);

  const free = MODELS.filter((m) => m.tier === 'free');
  const paid = MODELS.filter((m) => m.tier === 'paid');

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
        <optgroup label="Free">
          {free.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </optgroup>
        <optgroup label="Paid">
          {paid.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </optgroup>
      </select>
    </section>
  );
}

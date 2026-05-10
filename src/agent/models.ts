// src/agent/models.ts
//
// Curated OpenRouter model list. Every entry is verified to support function
// calling at the time of authoring — see the ID lock-in checkpoint in the
// implementation plan task that introduced this file.

export interface ModelOption {
  /** OpenRouter model ID, e.g. 'meta-llama/llama-3.3-70b-instruct:free'. */
  id: string;
  /** Human-readable label rendered in the picker. */
  label: string;
  tier: 'free' | 'paid';
  /** Always true — non-tool-capable models are excluded by curation. */
  supportsTools: true;
}

export const MODELS: ModelOption[] = [
  // Free, tool-capable. The first entry is the default.
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'Llama 3.3 70B Instruct (free) — default',
    tier: 'free',
    supportsTools: true,
  },
  {
    id: 'openai/gpt-oss-120b:free',
    label: 'GPT-OSS 120B (free, reasoning trace hidden)',
    tier: 'free',
    supportsTools: true,
  },

  // Paid premium models, ordered cheapest → priciest within each provider.
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    tier: 'paid',
    supportsTools: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    tier: 'paid',
    supportsTools: true,
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    tier: 'paid',
    supportsTools: true,
  },
  {
    id: 'google/gemini-2.0-flash-001',
    label: 'Gemini 2.0 Flash',
    tier: 'paid',
    supportsTools: true,
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function isKnownModel(id: string): boolean {
  return MODELS.some((m) => m.id === id);
}

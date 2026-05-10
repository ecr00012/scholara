import { DEFAULT_MODEL_ID, isKnownModel } from '../models';

export const DEFAULT_MODEL_KEY = 'scholara_default_model';

export function readDefaultModel(): string {
  const stored = localStorage.getItem(DEFAULT_MODEL_KEY);
  return stored && isKnownModel(stored) ? stored : DEFAULT_MODEL_ID;
}

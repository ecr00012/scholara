import type { GutenbergBook } from '../../../lib/gutenbergApi';

export type PanelState =
  | { kind: 'loading' }
  | { kind: 'missing-key' }
  | { kind: 'invalid-key' }
  | { kind: 'offline' }
  | { kind: 'api-error' }
  | { kind: 'ready'; books: GutenbergBook[] };

export type { GutenbergBook };

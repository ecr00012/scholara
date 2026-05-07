import type { Position } from '../../lib/positionShape';

export const GO_TO_SOURCE_EVENT = 'scholara:go-to-source';

export type ReaderNavItemKind = 'cover' | 'chapter';

export interface ReaderNavItem {
  id: string;
  label: string;
  position: Position;
  kind: ReaderNavItemKind;
  level?: number;
  progress?: number;
}

export interface ReaderSearchResult {
  id: string;
  label: string;
  snippet: string;
  position: Position;
}

export interface ReaderPreferences {
  fontScale: number;
  fontFamily: 'original' | 'arial' | 'georgia' | 'iowan';
}

export type ReaderSearchStatus = 'idle' | 'indexing' | 'ready' | 'empty';

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontScale: 100,
  fontFamily: 'original',
};

export function dispatchReaderNavigation(position: Position): void {
  window.dispatchEvent(
    new CustomEvent<Position>(GO_TO_SOURCE_EVENT, { detail: position }),
  );
}

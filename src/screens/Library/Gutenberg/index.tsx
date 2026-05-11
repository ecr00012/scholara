import { useCallback, useEffect, useRef, useState } from 'react';
import { getDb } from '../../../db/client';
import {
  advanceCursor,
  getCachedFetch,
  setCachedFetch,
} from '../../../db/gutenbergPanel';
import { fetchBooks, type GutenbergBook } from '../../../lib/gutenbergApi';
import {
  FRESHNESS_TTL_MS,
  isFresh,
} from '../../../lib/gutenbergCacheFreshness';
import { ApiErrorState } from './ApiErrorState';
import { BookGrid2x2 } from './BookGrid2x2';
import { DetailModal } from './DetailModal';
import { LoadingSkeleton } from './LoadingSkeleton';
import { OfflineState } from './OfflineState';
import { PanelHeading } from './PanelHeading';
import type { PanelState } from './types';

export function GutenbergPanel() {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  const [selected, setSelected] = useState<GutenbergBook | null>(null);
  const evaluatingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evaluateRef = useRef<() => Promise<void>>(async () => {});

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current === null) return;
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, []);

  const scheduleRefresh = useCallback(
    (lastFetchedAt: number | null, now: number) => {
      clearRefreshTimer();
      if (lastFetchedAt === null) return;

      const refreshIn = Math.max(0, lastFetchedAt + FRESHNESS_TTL_MS - now);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void evaluateRef.current();
      }, refreshIn);
    },
    [clearRefreshTimer],
  );

  const evaluate = useCallback(async () => {
    if (evaluatingRef.current) return;
    evaluatingRef.current = true;
    try {
      const db = await getDb();
      const cache = await getCachedFetch(db);
      const hasCachedPayload = Boolean(cache.payload && cache.payload.length > 0);

      if (
        hasCachedPayload &&
        isFresh(cache.lastFetchedAt, Date.now())
      ) {
        scheduleRefresh(cache.lastFetchedAt, Date.now());
        setState({ kind: 'ready', books: cache.payload! });
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        clearRefreshTimer();
        setState(
          hasCachedPayload
            ? { kind: 'ready', books: cache.payload! }
            : { kind: 'offline' },
        );
        return;
      }

      setState({ kind: 'loading' });
      const result = await fetchBooks(cache.cursor);
      if (result.kind === 'ok') {
        const fetchedAt = Date.now();
        const next = {
          cursor: advanceCursor(cache.cursor),
          lastFetchedAt: fetchedAt,
          payload: result.books,
        };
        await setCachedFetch(db, next);
        scheduleRefresh(next.lastFetchedAt, fetchedAt);
        setState({ kind: 'ready', books: result.books });
        return;
      }
      if (hasCachedPayload) {
        clearRefreshTimer();
        setState({ kind: 'ready', books: cache.payload! });
        return;
      }
      clearRefreshTimer();
      setState({
        kind: result.kind === 'offline' ? 'offline' : 'api-error',
      });
    } finally {
      evaluatingRef.current = false;
    }
  }, [clearRefreshTimer, scheduleRefresh]);

  useEffect(() => {
    evaluateRef.current = evaluate;
  }, [evaluate]);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  useEffect(() => clearRefreshTimer, [clearRefreshTimer]);

  useEffect(() => {
    const onOnline = () => {
      setState((prev) =>
        prev.kind === 'offline' ? { kind: 'loading' } : prev,
      );
      void evaluate();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [evaluate]);

  const handleRetry = useCallback(() => {
    void evaluate();
  }, [evaluate]);

  return (
    <div className="flex flex-[2] flex-col gap-3 rounded-md border border-stone-200 bg-cream p-4">
      <PanelHeading />
      {state.kind === 'loading' && <LoadingSkeleton />}
      {state.kind === 'offline' && <OfflineState />}
      {state.kind === 'api-error' && <ApiErrorState onRetry={handleRetry} />}
      {state.kind === 'ready' && (
        <BookGrid2x2 books={state.books} onSelect={setSelected} />
      )}
      <DetailModal book={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

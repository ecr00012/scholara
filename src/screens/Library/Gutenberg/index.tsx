import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const evaluatingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evaluateRef = useRef<(options?: { force?: boolean }) => Promise<void>>(
    async () => {},
  );

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
        void evaluateRef.current({ force: true });
      }, refreshIn);
    },
    [clearRefreshTimer],
  );

  const evaluate = useCallback(async (options?: { force?: boolean }) => {
    if (evaluatingRef.current) return;
    const force = options?.force ?? false;
    evaluatingRef.current = true;
    try {
      const db = await getDb();
      const cache = await getCachedFetch(db);
      const hasCachedPayload = Boolean(cache.payload && cache.payload.length > 0);

      if (
        !force &&
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

      if (!force || !hasCachedPayload) {
        setState({ kind: 'loading' });
      }
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

  const handleManualRefresh = useCallback(() => {
    setIsRefreshing(true);
    void evaluate({ force: true }).finally(() => setIsRefreshing(false));
  }, [evaluate]);

  return (
    <div className="flex flex-[2] flex-col gap-3 rounded-md border border-stone-200 bg-cream p-4">
      <div className="flex items-start justify-between gap-3">
        <PanelHeading />
        <Button
          aria-label="Refresh Project Gutenberg picks"
          title="Refresh Project Gutenberg picks"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-ink-muted hover:text-ink"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            aria-hidden="true"
            className={isRefreshing ? 'animate-spin' : undefined}
          />
        </Button>
      </div>
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

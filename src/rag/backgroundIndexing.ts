import {
  ensureBookIndexed,
  type IndexableBook,
  type IndexProgress,
} from './index';

export type BackgroundIndexStatus = 'idle' | 'running' | 'ready' | 'error';

export interface BackgroundIndexSnapshot {
  status: BackgroundIndexStatus;
  progress: IndexProgress;
  error: string | null;
}

type Listener = (snapshot: BackgroundIndexSnapshot) => void;

interface BackgroundIndexJob {
  promise: Promise<void>;
  snapshot: BackgroundIndexSnapshot;
  listeners: Set<Listener>;
}

const defaultProgress: IndexProgress = {
  total: 0,
  done: 0,
  phase: 'extracting',
};

const jobs = new Map<number, BackgroundIndexJob>();

function idleSnapshot(): BackgroundIndexSnapshot {
  return {
    status: 'idle',
    progress: defaultProgress,
    error: null,
  };
}

function getOrCreateJob(bookId: number): BackgroundIndexJob {
  let job = jobs.get(bookId);
  if (!job) {
    job = {
      promise: Promise.resolve(),
      snapshot: idleSnapshot(),
      listeners: new Set(),
    };
    jobs.set(bookId, job);
  }
  return job;
}

function updateSnapshot(
  bookId: number,
  snapshot: BackgroundIndexSnapshot,
): void {
  const job = getOrCreateJob(bookId);
  job.snapshot = snapshot;
  for (const listener of job.listeners) {
    listener(snapshot);
  }
}

export function getBackgroundIndexSnapshot(
  bookId: number,
): BackgroundIndexSnapshot {
  return getOrCreateJob(bookId).snapshot;
}

export function subscribeToBackgroundIndexing(
  bookId: number,
  listener: Listener,
): () => void {
  const job = getOrCreateJob(bookId);
  job.listeners.add(listener);
  listener(job.snapshot);
  return () => {
    job.listeners.delete(listener);
  };
}

export function startBackgroundIndexing(book: IndexableBook): Promise<void> {
  const existing = jobs.get(book.id);
  if (existing?.snapshot.status === 'running') {
    return existing.promise;
  }

  updateSnapshot(book.id, {
    status: 'running',
    progress: defaultProgress,
    error: null,
  });

  const promise = (async () => {
    try {
      await ensureBookIndexed(book, (progress) => {
        updateSnapshot(book.id, {
          status: progress.phase === 'done' ? 'ready' : 'running',
          progress,
          error: null,
        });
      });

      const latest = getBackgroundIndexSnapshot(book.id);
      updateSnapshot(book.id, {
        status: 'ready',
        progress:
          latest.progress.phase === 'done'
            ? latest.progress
            : { ...latest.progress, phase: 'done' },
        error: null,
      });
    } catch (err) {
      updateSnapshot(book.id, {
        status: 'error',
        progress: getBackgroundIndexSnapshot(book.id).progress,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  getOrCreateJob(book.id).promise = promise;
  return promise;
}

export function __resetBackgroundIndexingForTests(): void {
  jobs.clear();
}

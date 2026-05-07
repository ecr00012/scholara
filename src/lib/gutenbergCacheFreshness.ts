export const FRESHNESS_TTL_MS = 24 * 60 * 60 * 1000;

export function isFresh(lastFetchedAt: number | null, now: number): boolean {
  if (lastFetchedAt === null) return false;
  return now - lastFetchedAt < FRESHNESS_TTL_MS;
}

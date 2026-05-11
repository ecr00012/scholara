const ACTIVE_WINDOW_MS = 900;

let lastInteractionAt = 0;

export function markIndexingInteraction(): void {
  lastInteractionAt = Date.now();
}

export function isIndexingInteractionActive(now = Date.now()): boolean {
  return now - lastInteractionAt < ACTIVE_WINDOW_MS;
}

export function __resetIndexingActivityForTests(): void {
  lastInteractionAt = 0;
}

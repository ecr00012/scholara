const controllers = new Map<number, AbortController>();

export function setAbortController(
  bookId: number,
  ctrl: AbortController,
): void {
  controllers.get(bookId)?.abort();
  controllers.set(bookId, ctrl);
}

export function abortFor(bookId: number): void {
  const c = controllers.get(bookId);
  if (c) {
    c.abort();
    controllers.delete(bookId);
  }
}

export function clearAbortController(bookId: number): void {
  controllers.delete(bookId);
}

export function __resetAbortRegistryForTests(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
}

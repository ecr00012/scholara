export function getProgress(json: string | null): number | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  let fraction: unknown;
  if (typeof parsed === 'object' && parsed !== null) {
    if ('end' in parsed && typeof (parsed as { end?: unknown }).end === 'object') {
      fraction = ((parsed as { end: { fraction?: unknown } }).end).fraction;
    } else {
      fraction = (parsed as { fraction?: unknown }).fraction;
    }
  }
  if (typeof fraction !== 'number' || Number.isNaN(fraction)) return null;
  return Math.max(0, Math.min(1, fraction));
}

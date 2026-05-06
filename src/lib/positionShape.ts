export type Position =
  | { type: 'pdf';  locator: number; fraction: number; label: string }
  | { type: 'epub'; locator: string; fraction: number; label: string };

export interface EpubQuoteRange {
  start: Extract<Position, { type: 'epub' }>;
  end:   Extract<Position, { type: 'epub' }>;
  /**
   * Canonical epub.js range CFI as returned by `contents.cfiFromRange(...)`.
   * Required to render annotations: epub.js range CFIs have the shape
   * `epubcfi(base!common,startTail,endTail)` and cannot be reconstructed by
   * concatenating two collapsed point CFIs. Optional for backwards
   * compatibility with notes saved before this field was added.
   */
  cfiRange?: string;
}

export interface PdfQuoteRange {
  start: Extract<Position, { type: 'pdf' }>;
  end:   Extract<Position, { type: 'pdf' }>;
  pages: Array<{
    page: number;
    rects: Array<{ x: number; y: number; w: number; h: number }>;
  }>;
}

export type QuoteRange = EpubQuoteRange | PdfQuoteRange;

export function serializePosition(p: Position): string {
  return JSON.stringify(p);
}

export function deserializePosition(json: string): Position {
  return JSON.parse(json) as Position;
}

export function serializeQuoteRange(r: QuoteRange): string {
  return JSON.stringify(r);
}

export function deserializeQuoteRange(json: string): QuoteRange {
  return JSON.parse(json) as QuoteRange;
}

/** True if the parsed JSON is a QuoteRange (has start+end), false if a single Position. */
export function isQuoteRange(parsed: unknown): parsed is QuoteRange {
  return typeof parsed === 'object'
      && parsed !== null
      && 'start' in parsed
      && 'end' in parsed;
}

export function parsePositionOrRange(json: string): Position | QuoteRange | null {
  try {
    return JSON.parse(json) as Position | QuoteRange;
  } catch {
    return null;
  }
}

export function getSourcePosition(value: Position | QuoteRange): Position {
  return isQuoteRange(value) ? value.start : value;
}

export function getSourcePositionFromJson(json: string): Position | null {
  const parsed = parsePositionOrRange(json);
  return parsed ? getSourcePosition(parsed) : null;
}

export function formatPositionLabel(
  json: string,
  options: { epubLocations?: string | null } = {},
): string {
  const position = getSourcePositionFromJson(json);
  if (!position) return '';

  if (position.type === 'pdf') return position.label;

  const page = estimateEpubPage(position.fraction, options.epubLocations);
  if (!page) return position.label;
  if (new RegExp(`\\bpage\\s+${page}\\b`, 'i').test(position.label)) {
    return position.label;
  }
  return `${position.label} · Page ${page}`;
}

function estimateEpubPage(
  fraction: number,
  epubLocations?: string | null,
): number | null {
  if (!Number.isFinite(fraction)) return null;

  const count = countEpubLocations(epubLocations);
  if (!count) return null;

  return Math.min(Math.max(Math.ceil(fraction * count), 1), count);
}

function countEpubLocations(epubLocations?: string | null): number | null {
  if (!epubLocations) return null;

  try {
    const parsed = JSON.parse(epubLocations) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'locations' in parsed &&
      Array.isArray((parsed as { locations?: unknown }).locations)
    ) {
      return (parsed as { locations: unknown[] }).locations.length;
    }
  } catch {
    return null;
  }

  return null;
}

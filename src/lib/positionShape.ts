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

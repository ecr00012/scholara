export interface RawSegment {
  /** Position marker for the segment start (PDF page number as string, EPUB CFI, etc.). */
  positionMarker: string;
  /** Plain text for this segment (typically a page or section). */
  text: string;
}

export interface Chunk {
  ordinal: number;
  positionMarker: string;
  text: string;
}

const TARGET_CHARS = 1500; // ~350-400 tokens per chunk
const OVERLAP_CHARS = 200;

/**
 * Joins segments end-to-end and slices into ~TARGET_CHARS chunks with
 * OVERLAP_CHARS of overlap. Each chunk's positionMarker is taken from the
 * segment that contains the chunk's start character.
 */
export function chunkSegments(segments: RawSegment[]): Chunk[] {
  // Build a flat string with an index map: char -> segment index.
  let flat = '';
  const segOf: number[] = [];
  segments.forEach((seg, i) => {
    flat += seg.text + '\n';
    for (let j = 0; j < seg.text.length + 1; j++) segOf.push(i);
  });

  const chunks: Chunk[] = [];
  let ordinal = 0;
  let start = 0;
  while (start < flat.length) {
    let end = Math.min(start + TARGET_CHARS, flat.length);
    // Snap to nearest paragraph break within the last 200 chars to avoid splitting words.
    if (end < flat.length) {
      const slice = flat.slice(start, end);
      const lastBreak = slice.lastIndexOf('\n\n');
      const cut = lastBreak >= TARGET_CHARS - 400 ? lastBreak : -1;
      if (cut > 0) end = start + cut;
    }
    const text = flat.slice(start, end).trim();
    if (text.length > 0) {
      const segIdx = segOf[start] ?? 0;
      chunks.push({
        ordinal: ordinal++,
        positionMarker: segments[segIdx]?.positionMarker ?? '',
        text,
      });
    }
    if (end >= flat.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return chunks;
}

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  serializePosition,
  deserializePosition,
  serializeQuoteRange,
  deserializeQuoteRange,
  isQuoteRange,
} from '../../src/lib/positionShape';
import type { Position, EpubQuoteRange, PdfQuoteRange } from '../../src/lib/positionShape';

describe('positionShape', () => {
  it('round-trips a PDF Position', () => {
    const p: Position = { type: 'pdf', locator: 5, fraction: 0.25, label: 'Page 5' };
    expect(deserializePosition(serializePosition(p))).toEqual(p);
  });

  it('round-trips an EPUB Position', () => {
    const p: Position = {
      type: 'epub',
      locator: 'epubcfi(/6/4!/4/2/2)',
      fraction: 0.4,
      label: 'Chapter 3',
    };
    expect(deserializePosition(serializePosition(p))).toEqual(p);
  });

  it('round-trips an EPUB QuoteRange', () => {
    const r: EpubQuoteRange = {
      start: { type: 'epub', locator: 'cfiA', fraction: 0.1, label: 'Ch 1' },
      end:   { type: 'epub', locator: 'cfiB', fraction: 0.11, label: 'Ch 1' },
    };
    expect(deserializeQuoteRange(serializeQuoteRange(r))).toEqual(r);
  });

  it('round-trips a PDF QuoteRange with rects', () => {
    const r: PdfQuoteRange = {
      start: { type: 'pdf', locator: 1, fraction: 0.1, label: 'Page 1' },
      end:   { type: 'pdf', locator: 2, fraction: 0.2, label: 'Page 2' },
      pages: [
        { page: 1, rects: [{ x: 10, y: 20, w: 100, h: 12 }] },
        { page: 2, rects: [{ x: 10, y: 30, w: 80,  h: 12 }] },
      ],
    };
    expect(deserializeQuoteRange(serializeQuoteRange(r))).toEqual(r);
  });

  it('isQuoteRange detects a range vs a single position', () => {
    const range = { start: { type: 'pdf', locator: 1, fraction: 0, label: 'Page 1' },
                    end:   { type: 'pdf', locator: 1, fraction: 0, label: 'Page 1' } };
    const single = { type: 'pdf', locator: 1, fraction: 0, label: 'Page 1' };
    expect(isQuoteRange(range)).toBe(true);
    expect(isQuoteRange(single)).toBe(false);
  });
});

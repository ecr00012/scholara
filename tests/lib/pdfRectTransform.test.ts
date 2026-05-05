// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { viewportRectToPdfRect, pdfRectToViewportRect } from '../../src/lib/pdfRectTransform';

interface MockViewport {
  scale: number;
  height: number;
  convertToViewportPoint(x: number, y: number): [number, number];
  convertToPdfPoint(x: number, y: number): [number, number];
}

function makeViewport(scale: number, pageHeightPdfPts: number): MockViewport {
  // PDF coords: origin bottom-left, +y up.
  // Viewport coords: origin top-left, +y down.
  // y_view = (pageHeight - y_pdf) * scale; x_view = x_pdf * scale.
  return {
    scale,
    height: pageHeightPdfPts * scale,
    convertToViewportPoint: (x, y) => [x * scale, (pageHeightPdfPts - y) * scale],
    convertToPdfPoint: (x, y) => [x / scale, pageHeightPdfPts - y / scale],
  };
}

describe('pdfRectTransform', () => {
  it('viewportRectToPdfRect inverts pdfRectToViewportRect', () => {
    const vp = makeViewport(2, 800);  // scale=2, page=800pt tall
    const pdf = { x: 100, y: 200, w: 50, h: 12 };
    const view = pdfRectToViewportRect(pdf, vp);
    expect(viewportRectToPdfRect(view, vp)).toEqual(pdf);
  });

  it('pdfRectToViewportRect: scale=1 page=600pt, rect at (10, 100, 50w, 12h)', () => {
    const vp = makeViewport(1, 600);
    // top in viewport = (600 - (100+12)) * 1 = 488
    expect(pdfRectToViewportRect({ x: 10, y: 100, w: 50, h: 12 }, vp))
      .toEqual({ x: 10, y: 488, w: 50, h: 12 });
  });
});

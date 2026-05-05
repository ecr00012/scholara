export interface ViewportLike {
  scale: number;
  convertToViewportPoint(x: number, y: number): number[];   // [x, y]
  convertToPdfPoint(x: number, y: number): number[];        // [x, y]
}

export interface PdfRect    { x: number; y: number; w: number; h: number }
export interface ViewRect   { x: number; y: number; w: number; h: number }

/** PDF-space rect (origin bottom-left) → viewport-pixel rect (origin top-left). */
export function pdfRectToViewportRect(r: PdfRect, vp: ViewportLike): ViewRect {
  const [x, yTop] = vp.convertToViewportPoint(r.x, r.y + r.h);
  return { x, y: yTop, w: r.w * vp.scale, h: r.h * vp.scale };
}

/** Viewport-pixel rect → PDF-space rect (used when capturing user selection). */
export function viewportRectToPdfRect(r: ViewRect, vp: ViewportLike): PdfRect {
  const [xPdf, yPdfTop] = vp.convertToPdfPoint(r.x, r.y);
  const wPdf = r.w / vp.scale;
  const hPdf = r.h / vp.scale;
  return { x: xPdf, y: yPdfTop - hPdf, w: wPdf, h: hPdf };
}

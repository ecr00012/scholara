import { GlobalWorkerOptions } from 'pdfjs-dist';
// Vite transforms `?url` into a static asset URL at build time.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let initialised = false;

export function initPdfWorker(): void {
  if (initialised) return;
  GlobalWorkerOptions.workerSrc = workerUrl;
  initialised = true;
}

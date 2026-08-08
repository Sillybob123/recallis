// Renders each page of a PDF (lecture slides exported from PowerPoint work
// too: File → Save As → PDF) to a PNG blob, entirely in the browser.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 150;
/** Long-edge target in pixels — sharp enough to read, small enough to store. */
const TARGET_LONG_EDGE = 1600;

export async function renderPdfToSlides(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<Blob[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  const blobs: Blob[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = TARGET_LONG_EDGE / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale: Math.min(Math.max(scale, 0.5), 4) });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Slide render failed"))),
        "image/png"
      )
    );
    blobs.push(blob);
    onProgress?.(i, pageCount);
    page.cleanup();
  }
  await pdf.cleanup();
  return blobs;
}

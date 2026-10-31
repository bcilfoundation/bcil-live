// PDF reading with pdf.js, loaded only when someone opens a book (it is large).
// The legacy build also works on older phones.
import type { PDFDocumentProxy } from "pdfjs-dist";

let lib: Promise<typeof import("pdfjs-dist")> | null = null;
export function pdfjs() {
  if (!lib) lib = (async () => {
    const m = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as typeof import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
    m.GlobalWorkerOptions.workerSrc = worker;
    return m;
  })();
  return lib;
}

export type OpenPdf = { doc: PDFDocumentProxy; close: () => void };
export async function openPdf(src: string | ArrayBuffer): Promise<OpenPdf> {
  const m = await pdfjs();
  const task = m.getDocument(typeof src === "string" ? { url: src } : { data: new Uint8Array(src) });
  const doc = await task.promise;
  return { doc, close: () => { task.destroy(); } };
}

/** Draw one page into a canvas, sized to the given CSS width (sharp on high-density screens). */
export async function renderPage(doc: PDFDocumentProxy, n: number, canvas: HTMLCanvasElement, cssWidth: number) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const scale = (cssWidth / base.width) * dpr;
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
  canvas.style.width = `${cssWidth}px`; canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
  const task = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp });
  await task.promise;
  return task;
}

/** Make a JPEG cover from the first page, for books uploaded without a cover image. */
export async function coverFromPdf(file: File): Promise<{ blob: Blob; pages: number }> {
  const { doc, close } = await openPdf(await file.arrayBuffer());
  const canvas = document.createElement("canvas");
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 480 / page.getViewport({ scale: 1 }).width });
  canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("Could not make a cover"))), "image/jpeg", 0.82));
  const pages = doc.numPages; close();
  return { blob, pages };
}

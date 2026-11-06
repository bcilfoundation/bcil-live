// "Download with comments": the reviewed document as a PDF, with numbered comment pins drawn on the pages
// and every comment and reply listed at the end.
import { openPdf, renderPage } from "./pdf";

export type ExportComment = { id: number; parent_id: number | null; page: number | null; x: number | null; y: number | null; quote: string | null;
  body: string; resolved: boolean; created_at: string; author: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Draw the numbered pins for one page onto a canvas (pins are stored as shares of the page width and height). */
function drawPins(c: HTMLCanvasElement, pins: { n: number; x: number; y: number; done: boolean }[]) {
  const g = c.getContext("2d")!;
  const r = Math.max(14, c.width / 55);
  for (const p of pins) {
    const cx = p.x * c.width, cy = p.y * c.height - r;   // the pin's point sits on the spot, like on screen
    g.globalAlpha = p.done ? 0.55 : 1;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = "#F5B301"; g.fill();
    g.lineWidth = r / 5; g.strokeStyle = "#FFFFFF"; g.stroke();
    g.fillStyle = "#0F2D52"; g.font = `bold ${Math.round(r * 1.05)}px Helvetica, Arial, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(p.n), cx, cy + 1);
    g.globalAlpha = 1;
  }
}

export async function downloadWithComments(o: { name: string; url: string; kind: string; comments: ExportComment[]; numbers: Record<number, number> }) {
  const { jsPDF } = await import("jspdf");
  const threads = o.comments.filter((c) => !c.parent_id);
  const pinsFor = (page: number | null) => threads.filter((t) => t.x != null && t.y != null && (t.page ?? null) === page && o.numbers[t.id])
    .map((t) => ({ n: o.numbers[t.id], x: t.x!, y: t.y!, done: t.resolved }));
  let doc: InstanceType<typeof jsPDF> | null = null;
  // add a picture of a page, scaled to fit an A4 page (portrait or landscape to match)
  const addImagePage = (c: HTMLCanvasElement) => {
    const land = c.width > c.height;
    const pw = land ? 297 : 210, ph = land ? 210 : 297, m = 8;
    const s = Math.min((pw - 2 * m) / c.width, (ph - 2 * m) / c.height);
    const w = c.width * s, h = c.height * s;
    if (!doc) doc = new jsPDF({ unit: "mm", format: "a4", orientation: land ? "landscape" : "portrait" });
    else doc.addPage("a4", land ? "landscape" : "portrait");
    doc.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", (pw - w) / 2, (ph - h) / 2, w, h);
  };

  if (o.kind === "pdf") {
    const pdf = await openPdf(o.url);
    try {
      for (let n = 1; n <= pdf.doc.numPages; n++) {
        const c = document.createElement("canvas");
        await renderPage(pdf.doc, n, c, 1100 / Math.min(window.devicePixelRatio || 1, 2.5));
        drawPins(c, pinsFor(n));
        addImagePage(c);
      }
    } finally { pdf.close(); }
  } else if (o.kind === "image") {
    const blob = await (await fetch(o.url)).blob();
    const src = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      drawPins(c, pinsFor(null));
      addImagePage(c);
    } finally { URL.revokeObjectURL(src); }
  }

  // the comments, in pin order, then general comments
  const d = doc ?? new jsPDF({ unit: "mm", format: "a4" });
  if (doc) d.addPage("a4", "portrait");
  const W = 210, M = 16; let y = 20;
  const line = (text: string, size: number, style: "normal" | "bold" | "italic", color: [number, number, number], indent = 0) => {
    d.setFont("helvetica", style); d.setFontSize(size); d.setTextColor(...color);
    for (const l of d.splitTextToSize(text, W - 2 * M - indent) as string[]) { if (y > 282) { d.addPage("a4", "portrait"); y = 18; } d.text(l, M + indent, y); y += size * 0.42 + 1.4; }
  };
  line("COMMENTS", 10, "bold", [201, 162, 39]);
  line(o.name, 15, "bold", [30, 63, 120]);
  line(`Downloaded ${when(new Date().toISOString())} · ${threads.length} comment${threads.length === 1 ? "" : "s"}`, 9, "italic", [110, 118, 130]);
  if (o.kind === "docx" || o.kind === "other") line("The comments below refer to the original file. Quoted text shows the words each comment is about.", 9, "italic", [110, 118, 130]);
  y += 3;
  const ordered = [...threads].sort((a, b) => (o.numbers[a.id] ?? 1e9) - (o.numbers[b.id] ?? 1e9) || a.created_at.localeCompare(b.created_at));
  if (!ordered.length) line("No comments yet.", 11, "normal", [43, 52, 64]);
  for (const t of ordered) {
    y += 3;
    const tag = o.numbers[t.id] ? `Comment ${o.numbers[t.id]}${t.page ? ` · page ${t.page}` : ""}` : "General comment";
    line(`${tag}${t.resolved ? "  (resolved)" : ""}`, 11, "bold", [30, 63, 120]);
    if (t.quote) line(`"${t.quote}"`, 9.5, "italic", [90, 90, 90], 3);
    line(`${t.author} · ${when(t.created_at)}`, 9, "bold", [43, 52, 64], 3);
    line(t.body, 10.5, "normal", [43, 52, 64], 3);
    for (const r of o.comments.filter((c) => c.parent_id === t.id)) {
      line(`Reply: ${r.author} · ${when(r.created_at)}`, 9, "bold", [43, 52, 64], 9);
      line(r.body, 10, "normal", [43, 52, 64], 9);
    }
  }
  y += 6; line("BCIL Foundation · Grooming Generational Leaders", 8, "italic", [120, 128, 140]);
  d.save(`${o.name.replace(/\.[^.]+$/, "")} - with comments.pdf`);
}

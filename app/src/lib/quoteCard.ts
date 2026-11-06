// Branded Daily Bite images (1080 × 1080, right for Facebook, Instagram, WhatsApp status and X),
// plus the caption that goes with them.
export type BiteQ = { body: string; author: string; show_on: string; reflection?: string | null };

const NAVY = "#1e3f78", DEEP = "#0f2d52", GOLD = "#c9a227";
const S = 1080;

let logo: Promise<HTMLImageElement | null> | null = null;
function loadLogo() {
  if (!logo) logo = new Promise((ok) => {
    const i = new Image();
    i.onload = () => ok(i); i.onerror = () => ok(null);
    i.src = `${import.meta.env.BASE_URL}logo-wordmark.png`;
  });
  return logo;
}

function wrap(g: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > width && line) { lines.push(line); line = word; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}

export const biteDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Draw the Daily Bite card. */
export async function quoteCanvas(q: BiteQ) {
  await Promise.all([
    document.fonts?.load("800 40px 'Bricolage Grotesque'").catch(() => {}),
    document.fonts?.load("500 40px Figtree").catch(() => {}),
    document.fonts?.load("700 40px Figtree").catch(() => {}),
  ]);
  const c = document.createElement("canvas"); c.width = S; c.height = S;
  const g = c.getContext("2d")!;
  // background
  const bg = g.createLinearGradient(0, 0, S, S); bg.addColorStop(0, NAVY); bg.addColorStop(1, DEEP);
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  g.globalAlpha = 0.07; g.fillStyle = "#ffffff";
  g.beginPath(); g.arc(S - 90, 150, 300, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(80, S - 260, 220, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  // gold frame
  g.strokeStyle = GOLD; g.lineWidth = 4; g.strokeRect(44, 44, S - 88, S - 88 - 150);

  // header
  g.fillStyle = GOLD; g.font = "800 34px 'Bricolage Grotesque', system-ui, sans-serif"; g.textBaseline = "alphabetic";
  g.fillText("DAILY BITE", 96, 132);
  g.fillStyle = "rgba(255,255,255,.75)"; g.font = "500 28px Figtree, system-ui, sans-serif";
  g.fillText(biteDate(q.show_on), 96, 174);

  // big quote mark
  g.fillStyle = GOLD; g.font = "800 220px Georgia, serif";
  g.fillText("“", 84, 360);

  // the quote, as large as fits
  const boxW = S - 192, top = 300, bottom = S - 150 - 170;
  let size = 66, lines: string[] = [];
  for (; size >= 30; size -= 2) {
    g.font = `600 ${size}px Figtree, system-ui, sans-serif`;
    lines = wrap(g, q.body.trim(), boxW);
    if (lines.length * size * 1.32 <= bottom - top) break;
  }
  const lh = size * 1.32;
  let y = top + Math.max(0, (bottom - top - lines.length * lh) / 2) + size;
  g.fillStyle = "#ffffff";
  for (const l of lines) { g.fillText(l, 96, y); y += lh; }
  // author
  g.fillStyle = GOLD; g.font = "700 34px Figtree, system-ui, sans-serif";
  g.fillText(`— ${q.author}`, 96, Math.min(y + 30, S - 150 - 80));

  // footer band with the logo
  g.fillStyle = "#ffffff"; g.fillRect(0, S - 150, S, 150);
  g.fillStyle = GOLD; g.fillRect(0, S - 150, S, 6);
  const img = await loadLogo();
  if (img) { const h = 78, w = (img.width / img.height) * h; g.drawImage(img, 70, S - 150 + (150 - h) / 2 + 3, w, h); }
  else { g.fillStyle = NAVY; g.font = "800 44px 'Bricolage Grotesque', system-ui, sans-serif"; g.fillText("BCIL Foundation", 70, S - 60); }
  g.textAlign = "right"; g.fillStyle = NAVY; g.font = "700 26px Figtree, system-ui, sans-serif";
  g.fillText("Grooming Generational Leaders", S - 70, S - 84);
  g.fillStyle = "#5b6b80"; g.font = "500 24px Figtree, system-ui, sans-serif";
  g.fillText("live.bcilfoundation.org", S - 70, S - 48);
  g.textAlign = "left";
  return c;
}

export async function quoteBlob(q: BiteQ) {
  const c = await quoteCanvas(q);
  return new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("no image"))), "image/png"));
}

/** The caption to post with the image. */
export function biteCaption(q: BiteQ) {
  return [`“${q.body.trim()}” — ${q.author}`, q.reflection ? `Reflect: ${q.reflection}` : "",
    "Get a Daily Bite every morning in the BCIL Foundation app: live.bcilfoundation.org",
    "#BCILFoundation #DailyBite #GroomingGenerationalLeaders"].filter(Boolean).join("\n\n");
}

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** A month of bites as a zip: one image per day plus captions.csv, ready to schedule in Meta Business Suite. */
export async function monthPack(month: string, bites: BiteQ[]) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const rows = [["Date", "Image", "Caption"]];
  for (const q of bites) {
    const name = `${q.show_on} Daily Bite.png`;
    zip.file(name, await quoteBlob(q));
    zip.file(`${q.show_on} caption.txt`, biteCaption(q));
    rows.push([q.show_on, name, biteCaption(q)]);
  }
  const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  zip.file("captions.csv", "﻿" + csv);
  zip.file("HOW TO SCHEDULE.txt", [
    "Schedule these Daily Bites on Facebook and Instagram with Meta Business Suite (free):",
    "",
    "1. Go to business.facebook.com and open Planner (or Content > Planner).",
    "2. Click Create post. Choose the BCIL Facebook Page and the Instagram account.",
    "3. Add the image for a day (e.g. 2026-12-01 Daily Bite.png) and paste its caption (from the matching caption.txt).",
    "4. Click the arrow next to Publish > Schedule, pick that date and a time (e.g. 7:00 am), and schedule it.",
    "5. Repeat for each day. Tip: Meta Business Suite also has Bulk upload under Planner, which takes several posts at once.",
  ].join("\r\n"));
  saveBlob(await zip.generateAsync({ type: "blob" }), `BCIL Daily Bites ${month}.zip`);
}

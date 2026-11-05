import { supabase } from "./supabase";

export type CertInfo = { ok: boolean; reason: string; kind?: "participant" | "volunteer" | null; team?: string | null; name: string | null; event_title: string | null; event_subtitle: string | null; starts_on: string | null; venue: string | null; ticket: string };

/** What the database says about this ticket's certificate (works without an account: the ticket number is the key). */
export async function certificateInfo(ticket: string): Promise<CertInfo | null> {
  const { data } = await supabase.rpc("certificate_info", { p_ticket: ticket });
  return (data?.[0] as CertInfo | undefined) ?? null;
}

/** A short line for a member who can't download yet. */
export function certReason(c: CertInfo): string {
  switch (c.reason) {
    case "not_released": return "Certificates will be available here after the programme.";
    case "not_checked_in": return "Certificates are for people who were checked in at the programme.";
    case "not_served": return "Volunteer certificates are for volunteers checked in on the day. Ask the volunteer coordinator if this looks wrong.";
    case "not_requested": return "You didn't ask for a certificate on your registration form.";
    case "not_paid": return "Your certificate is ready once the certificate fee is confirmed.";
    default: return "";
  }
}

const NAVY = [30, 63, 120] as const, GOLD = [201, 162, 39] as const, INK = [43, 52, 64] as const;
const base = import.meta.env.BASE_URL;

async function dataUrl(url: string): Promise<{ src: string; w: number; h: number }> {
  const img = new Image(); img.crossOrigin = "anonymous"; img.src = url;
  await img.decode();
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return { src: c.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight };
}

const longDate = (d: string | null) => d ? new Date(d + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";

/** Build the certificate as an A4 landscape PDF and download it (volunteers get their own design). */
export async function downloadCertificate(c: CertInfo) {
  if (c.kind === "volunteer") return volunteerCertificate(c);
  const [{ jsPDF }, Q] = await Promise.all([import("jspdf"), import("qrcode")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, cx = W / 2;
  const name = (c.name || "Participant").trim();
  const checkUrl = `https://live.bcilfoundation.org/c/${c.ticket}`;

  // frame: navy outer border, thin gold inner border, gold corner accents
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, H, "F");
  doc.setDrawColor(...NAVY); doc.setLineWidth(3.2); doc.rect(8, 8, W - 16, H - 16);
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.8); doc.rect(13, 13, W - 26, H - 26);
  doc.setFillColor(...GOLD);
  for (const [x, y] of [[13, 13], [W - 13, 13], [13, H - 13], [W - 13, H - 13]]) doc.circle(x, y, 2.2, "F");

  // logo
  try {
    const logo = await dataUrl(`${base}logo-wordmark.png`);
    const lw = 62, lh = (lw * logo.h) / logo.w;
    doc.addImage(logo.src, "PNG", cx - lw / 2, 22, lw, lh);
  } catch { doc.setFont("times", "bold"); doc.setFontSize(20); doc.setTextColor(...NAVY); doc.text("BCIL FOUNDATION", cx, 32, { align: "center" }); }

  doc.setTextColor(...NAVY); doc.setFont("times", "bold"); doc.setFontSize(30);
  doc.text("CERTIFICATE OF PARTICIPATION", cx, 58, { align: "center", charSpace: 0.6 });
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.6); doc.line(cx - 40, 63, cx + 40, 63);

  doc.setTextColor(...INK); doc.setFont("times", "italic"); doc.setFontSize(14);
  doc.text("This is to certify that", cx, 76, { align: "center" });

  // the name, shrunk to fit long names
  doc.setTextColor(...NAVY); doc.setFont("times", "bolditalic");
  let size = 34; doc.setFontSize(size);
  while (doc.getTextWidth(name) > W - 80 && size > 18) { size -= 1; doc.setFontSize(size); }
  doc.text(name, cx, 93, { align: "center" });
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.3); doc.line(cx - 85, 97, cx + 85, 97);

  doc.setTextColor(...INK); doc.setFont("times", "normal"); doc.setFontSize(14);
  const what = [c.event_title, c.event_subtitle ? `(${c.event_subtitle})` : ""].filter(Boolean).join(" ");
  const where = [c.starts_on ? `on ${longDate(c.starts_on)}` : "", c.venue ? `at ${c.venue}` : ""].filter(Boolean).join(" ");
  const body = doc.splitTextToSize(`participated in ${what}${where ? `, held ${where}` : ""}, organised by BCIL Foundation.`, W - 90);
  doc.text(body, cx, 109, { align: "center" });
  doc.setFont("times", "italic"); doc.setFontSize(12); doc.setTextColor(...GOLD);
  doc.text("Grooming Generational Leaders", cx, 109 + body.length * 6.5 + 4, { align: "center" });

  // signature lines
  doc.setTextColor(...INK); doc.setFont("times", "normal"); doc.setFontSize(12); doc.setDrawColor(...INK); doc.setLineWidth(0.3);
  const { SIG_SOLOMON, SIG_EBENEZER } = await import("./signatures");
  const sig = (x: number, who: string, role: string, image: string, w: number, h: number) => {
    doc.addImage(image, "PNG", x - w / 2, 162 - h, w, h);
    doc.line(x - 38, 163, x + 38, 163);
    doc.setFont("times", "bold"); doc.text(who, x, 169, { align: "center" });
    doc.setFont("times", "normal"); doc.setFontSize(11); doc.text(role, x, 175, { align: "center" }); doc.setFontSize(12);
  };
  sig(78, "Solomon Agbesi", "Founder and Chairperson", SIG_SOLOMON, 26, 26 * 69 / 102);
  sig(W - 78, "Ebenezer Nyan", "Board Secretary", SIG_EBENEZER, 34, 34 * 69 / 158);

  // check code: QR + short number, anyone can confirm the certificate is genuine
  const qr = await Q.toDataURL(checkUrl, { width: 240, margin: 0, color: { dark: "#1E3F78", light: "#FFFFFF" } });
  doc.addImage(qr, "PNG", cx - 11, 151, 22, 22);
  doc.setFontSize(8); doc.setTextColor(110, 118, 130);
  doc.text(`Certificate no. ${c.ticket.slice(0, 8).toUpperCase()}  ·  scan the code to check it is genuine`, cx, 180, { align: "center" });

  const file = `${(c.event_title || "BCIL").replace(/[^a-z0-9]+/gi, " ").trim()} certificate - ${name.replace(/[^a-z0-9 .'-]+/gi, "").trim()}.pdf`;
  doc.save(file);
}


/** Volunteer certificate: "Certificate of Appreciation", gold frame with navy corner ribbons, the team they served on. */
async function volunteerCertificate(c: CertInfo) {
  const [{ jsPDF }, Q, { SIG_SOLOMON, SIG_EBENEZER }] = await Promise.all([import("jspdf"), import("qrcode"), import("./signatures")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, cx = W / 2;
  const name = (c.name || "Volunteer").trim();
  const checkUrl = `https://live.bcilfoundation.org/c/${c.ticket}`;

  // soft cream page, gold frame, navy corner ribbons
  doc.setFillColor(253, 250, 240); doc.rect(0, 0, W, H, "F");
  doc.setFillColor(...NAVY); doc.triangle(0, 0, 70, 0, 0, 52, "F"); doc.triangle(W, H, W - 70, H, W, H - 52, "F");
  doc.setFillColor(...GOLD); doc.triangle(0, 52, 70, 0, 78, 0, "F"); doc.triangle(0, 52, 0, 58, 78, 0, "F");
  doc.triangle(W, H - 52, W - 70, H, W - 78, H, "F"); doc.triangle(W, H - 52, W, H - 58, W - 78, H, "F");
  doc.setDrawColor(...GOLD); doc.setLineWidth(2.4); doc.rect(10, 10, W - 20, H - 20);
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.5); doc.rect(14, 14, W - 28, H - 28);

  try {
    const logo = await dataUrl(`${base}logo-wordmark.png`);
    const lw = 56, lh = (lw * logo.h) / logo.w;
    doc.addImage(logo.src, "PNG", cx - lw / 2, 22, lw, lh);
  } catch { /* the title carries the name */ }

  doc.setTextColor(...NAVY); doc.setFont("times", "bold"); doc.setFontSize(32);
  doc.text("CERTIFICATE OF APPRECIATION", cx, 56, { align: "center", charSpace: 0.5 });
  doc.setTextColor(...GOLD); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("F O R   V O L U N T E E R   S E R V I C E", cx, 65, { align: "center" });

  doc.setTextColor(...INK); doc.setFont("times", "italic"); doc.setFontSize(14);
  doc.text("Proudly presented to", cx, 79, { align: "center" });

  doc.setTextColor(...NAVY); doc.setFont("times", "bolditalic");
  let size = 34; doc.setFontSize(size);
  while (doc.getTextWidth(name) > W - 90 && size > 18) { size -= 1; doc.setFontSize(size); }
  doc.text(name, cx, 95, { align: "center" });
  doc.setDrawColor(...GOLD); doc.setLineWidth(0.8); doc.line(cx - 70, 99, cx + 70, 99);

  doc.setTextColor(...INK); doc.setFont("times", "normal"); doc.setFontSize(13.5);
  const where = [c.starts_on ? `on ${longDate(c.starts_on)}` : "", c.venue ? `at ${c.venue}` : ""].filter(Boolean).join(" ");
  const what = [c.event_title, c.event_subtitle ? `(${c.event_subtitle})` : ""].filter(Boolean).join(" ");
  const team = c.team ? ` on the ${c.team.replace(/^Other:\s*/i, "")} team` : "";
  const body = doc.splitTextToSize(`in grateful recognition of your dedicated service as a volunteer${team} at ${what}${where ? `, held ${where}` : ""}. Thank you for giving your time to help groom generational leaders.`, W - 96);
  doc.text(body, cx, 111, { align: "center" });

  doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.setTextColor(...INK);
  const sig = (x: number, who: string, role: string, image: string, w: number, h: number) => {
    doc.addImage(image, "PNG", x - w / 2, 162 - h, w, h);
    doc.line(x - 38, 163, x + 38, 163);
    doc.setFont("times", "bold"); doc.setFontSize(12); doc.text(who, x, 169, { align: "center" });
    doc.setFont("times", "normal"); doc.setFontSize(11); doc.text(role, x, 175, { align: "center" });
  };
  sig(78, "Solomon Agbesi", "Founder and Chairperson", SIG_SOLOMON, 26, 26 * 69 / 102);
  sig(W - 78, "Ebenezer Nyan", "Board Secretary", SIG_EBENEZER, 34, 34 * 69 / 158);

  // gold seal with the check code inside
  doc.setFillColor(...GOLD); doc.circle(cx, 162, 15, "F");
  doc.setFillColor(255, 255, 255); doc.circle(cx, 162, 12.6, "F");
  const qr = await Q.toDataURL(checkUrl, { width: 240, margin: 0, color: { dark: "#1E3F78", light: "#FFFFFF" } });
  doc.addImage(qr, "PNG", cx - 8, 154, 16, 16);
  doc.setFontSize(8); doc.setTextColor(110, 118, 130);
  doc.text(`Certificate no. ${c.ticket.slice(0, 8).toUpperCase()}  ·  scan the code to check it is genuine`, cx, 183, { align: "center" });

  doc.save(`${(c.event_title || "BCIL").replace(/[^a-z0-9]+/gi, " ").trim()} volunteer certificate - ${name.replace(/[^a-z0-9 .'-]+/gi, "").trim()}.pdf`);
}

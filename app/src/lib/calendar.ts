// Calendar helpers: open slots, and "add to calendar" links for confirmed meetings.
export type Slot = { slot_at: string; minutes: number };

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** A Google Calendar link that opens a new event, filled in. */
export function googleCalLink(o: { title: string; start: string; minutes?: number; details?: string; location?: string }) {
  const s = new Date(o.start), e = new Date(s.getTime() + (o.minutes ?? 30) * 60000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: o.title, dates: `${stamp(s)}/${stamp(e)}`, details: o.details ?? "", location: o.location ?? "" });
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** An .ics file for Apple Calendar, Outlook and others. */
export function icsFile(o: { uid: string; title: string; start: string; minutes?: number; details?: string; location?: string }) {
  const s = new Date(o.start), e = new Date(s.getTime() + (o.minutes ?? 30) * 60000);
  const esc = (t: string) => t.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BCIL Foundation//Meet Solomon//EN", "BEGIN:VEVENT", `UID:${o.uid}`,
    `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(s)}`, `DTEND:${stamp(e)}`, `SUMMARY:${esc(o.title)}`,
    o.details ? `DESCRIPTION:${esc(o.details)}` : "", o.location ? `LOCATION:${esc(o.location)}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  a.download = "BCIL meeting.ics"; document.body.appendChild(a); a.click(); a.remove();
}

/** The private calendar feed address for a token (subscribe to it once in Google Calendar). */
export const feedUrl = (token: string) =>
  `https://jvfqvbmebfzhenbiklyy.supabase.co/rest/v1/rpc/meetings_ics?token=${token}&apikey=sb_publishable_ZakDNVMn4JJyIsv3LaDAjA_ZnCBreTk`;

export const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
export const tzName = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " "); } catch { return "your time"; } };

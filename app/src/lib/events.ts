// Programmes (FCB, volunteer training, ...): when the next session is, and how long until then
export type Item = { time?: string; title: string; detail?: string };
export type Speaker = { name: string; role?: string; photo?: string };
export type Ev = {
  slug: string; title: string; subtitle: string | null; summary: string | null; starts_on: string | null; venue: string | null; about: string | null;
  hero_url: string | null; form_slug: string | null; online_url: string | null; listed: boolean; dates: string[]; schedule: Item[]; speakers: Speaker[];
};

const LONG = 3 * 3600e3;
const allDay = new WeakSet<Date>();   // programmes with a date but no time yet   // a session counts as "on now" for 3 hours after it starts

/** All session times, earliest first */
export function sessions(ev: Ev): Date[] {
  const list = (ev.dates ?? []).map((d) => new Date(d)).filter((d) => !isNaN(+d));
  if (!list.length && ev.starts_on) { const d = new Date(ev.starts_on + "T08:00:00Z"); allDay.add(d); list.push(d); }
  return list.sort((a, b) => +a - +b);
}
/** The next session that hasn't finished yet (or null if it's all over) */
export function nextSession(ev: Ev, now = Date.now()): Date | null {
  return sessions(ev).find((d) => +d + LONG > now) ?? null;
}
export const isOnNow = (d: Date, now = Date.now()) => +d <= now && now < +d + LONG;

/** "On now", "Starts in 3 h", "Tomorrow", "In 84 days" */
export function countdown(d: Date, now = Date.now()): string {
  if (isOnNow(d, now)) return "On now";
  const ms = +d - now, h = ms / 3600e3;
  if (h < 1) return `Starts in ${Math.max(1, Math.round(ms / 60e3))} min`;
  if (h < 12) return `Starts in ${Math.round(h)} h`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(new Date(now))) / 864e5);
  if (days <= 0) return `Today`;
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}
export const when = (d: Date, withYear = false) => allDay.has(d)
  ? new Date(+d + 4 * 3600e3).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) })
  : d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), hour: "numeric", minute: "2-digit", hour12: true });

/** Pictures stored in the app (e.g. /fcb/hero.jpg) or uploaded (full links) */
export const img = (u: string | null | undefined, fallback?: string) => {
  const v = u || fallback; if (!v) return "";
  return v.startsWith("/") ? import.meta.env.BASE_URL + v.slice(1) : v;
};
/** BCIL photos used as backgrounds for programmes without their own picture */
export const BG = ["/fcb/hero.jpg", "/fcb/p2.jpg", "/fcb/signin.jpg", "/fcb/p1.jpg", "/fcb/p3.jpg"];
export const bgFor = (slug: string) => BG[[...slug].reduce((n, c) => n + c.charCodeAt(0), 0) % BG.length];

export const EVENT_COLS = "slug, title, subtitle, summary, starts_on, venue, about, hero_url, form_slug, online_url, listed, dates, schedule, speakers";

// send-live-invite: emails the people invited to a live session by email address (through Resend),
// with the join link, an "Add to Google Calendar" button and a calendar file attached.
// Uses the same secrets as send-ticket: RESEND_API_KEY and TICKET_FROM.
// Called by the app with { session } after staff invite email addresses. Only staff or the host can call it.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
function secretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const v = Object.values(JSON.parse(raw))[0]; if (typeof v === "string") return v; } catch { /* fall through */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("TICKET_FROM");
  if (!key || !from) return json({ sent: 0, reason: "email not set up" });
  const { session } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(session ?? "")) return json({ error: "bad session" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false } });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(jwt);
  if (!who.user) return json({ error: "sign in first" }, 401);

  const { data: s } = await admin.from("live_sessions").select("id, title, starts_at, status, kind, host_id, is_private, invite_code").eq("id", session).maybeSingle();
  if (!s) return json({ error: "not found" }, 404);
  const { data: me } = await admin.from("profiles").select("full_name, role").eq("id", who.user.id).maybeSingle();
  if (s.host_id !== who.user.id && !["admin", "moderator"].includes(me?.role ?? "")) return json({ error: "not allowed" }, 403);

  const { data: list } = await admin.from("live_email_invites").select("email").eq("session_id", s.id).is("sent_at", null);
  if (!list?.length) return json({ sent: 0 });

  const link = `https://live.bcilfoundation.org/live${s.is_private && s.invite_code ? `?join=${s.invite_code}` : ""}`;
  const start = new Date(s.status === "live" ? Date.now() : s.starts_at), end = new Date(start.getTime() + 60 * 60e3);
  const nowLive = s.status === "live";
  const whenGh = start.toLocaleString("en-GB", { timeZone: "Africa/Accra", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true }) + " (Ghana time, GMT)";
  const kind = s.kind === "video" ? "video session" : "audio session";
  const host = me?.full_name || "BCIL Foundation";
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(s.title)}&dates=${stamp(start)}/${stamp(end)}&details=${encodeURIComponent(`Join in the BCIL Foundation app: ${link}`)}&location=${encodeURIComponent(link)}`;
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BCIL Foundation//Live//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:live-${s.id}@bcilfoundation.org`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${icsText(s.title)}`, `DESCRIPTION:${icsText(`Join in the BCIL Foundation app: ${link}`)}`, `URL:${link}`, `LOCATION:${icsText(link)}`,
    "BEGIN:VALARM", "TRIGGER:-PT15M", "ACTION:DISPLAY", "DESCRIPTION:Starting soon", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#13294b">
    <h2 style="margin:0 0 8px">${nowLive ? "Join now: " : "You're invited: "}${esc(s.title)}</h2>
    <p>${esc(host)} has invited you to a ${kind} with BCIL Foundation${nowLive ? ", happening <b>right now</b>." : ` on <b>${esc(whenGh)}</b>.`}</p>
    <p><a href="${link}" style="display:inline-block;background:#d6332b;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${nowLive ? "Join now" : "Open the session"}</a>
    ${nowLive ? "" : `&nbsp; <a href="${gcal}" style="display:inline-block;background:#1e3f78;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Add to Google Calendar</a>`}</p>
    <p style="color:#5b6b85;font-size:13px">Open the link on your phone or computer and sign in to the BCIL Foundation app (it's free). ${s.is_private ? "This session is private: please don't share the link." : ""}
    ${nowLive ? "" : "A calendar file is attached if you use another calendar."}</p>
    <p>BCIL Foundation · Grooming Generational Leaders</p></div>`;

  let sent = 0; const failed: string[] = [];
  for (const { email } of list) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: `${nowLive ? "Join now" : "Invitation"}: ${s.title}`, html,
        ...(nowLive ? {} : { attachments: [{ filename: "BCIL-session.ics", content: btoa(unescape(encodeURIComponent(ics))) }] }) }),
    });
    if (res.ok) { sent++; await admin.from("live_email_invites").update({ sent_at: new Date().toISOString() }).eq("session_id", s.id).eq("email", email); }
    else failed.push(email);
  }
  return json({ sent, failed });
});

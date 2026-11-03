// send-ticket: emails a registration's QR ticket (once per registration) through Resend.
// Needs the secrets RESEND_API_KEY and TICKET_FROM (e.g. "BCIL Foundation <tickets@bcilfoundation.org>").
// Called by the app right after someone registers, with { ticket }. Works for guests and members.
import { createClient } from "npm:@supabase/supabase-js@2";
import QRCode from "npm:qrcode@1.5.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
function secretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const v = Object.values(JSON.parse(raw))[0]; if (typeof v === "string") return v; } catch { /* fall through */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("TICKET_FROM");
  if (!key || !from) return json({ sent: false, reason: "email not set up" });
  const { ticket } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(ticket ?? "")) return json({ error: "bad ticket" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false } });
  const { data: r } = await admin.from("form_responses")
    .select("id, user_id, answers, guest_name, guest_email, ticket_emailed_at, forms(title, slug)").eq("ticket", ticket).maybeSingle();
  if (!r) return json({ error: "not found" }, 404);
  if (r.ticket_emailed_at) return json({ sent: false, reason: "already sent" });

  let email = (r.guest_email || r.answers?.email || "").trim();
  if (!email && r.user_id) { const { data } = await admin.auth.admin.getUserById(r.user_id); email = data.user?.email ?? ""; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ sent: false, reason: "no email" });
  const name = (r.answers?.full_name || r.answers?.name || r.guest_name || "there").split(" ")[0];
  const form = r.forms as unknown as { title: string; slug: string };
  const { data: ev } = await admin.from("event_pages").select("title, starts_on, venue").eq("form_slug", form.slug).maybeSingle();
  const title = ev?.title ?? form.title;
  const link = `https://live.bcilfoundation.org/t/${ticket}`;
  const png = (await QRCode.toDataURL(ticket, { width: 480, margin: 2 })).split(",")[1];
  const when = ev?.starts_on ? new Date(ev.starts_on + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";

  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#13294b">
    <h2 style="margin:0 0 8px">You're registered for ${esc(title)} 🎉</h2>
    <p>Hi ${esc(name)},</p>
    <p>Thank you for registering${when ? ` for <b>${esc(when)}</b>` : ""}${ev?.venue ? ` at <b>${esc(ev.venue)}</b>` : ""}. Your QR ticket is attached to this email.
    Show it at the registration desk on the day, on your phone or printed.</p>
    <p><a href="${link}" style="display:inline-block;background:#1e3f78;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open my ticket</a></p>
    <p style="color:#5b6b85;font-size:13px">Tip: take a screenshot of your ticket in case there's no internet at the venue.</p>
    <p>See you there,<br>BCIL Foundation · Grooming Generational Leaders</p></div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject: `Your ticket for ${title}`, html,
      attachments: [{ filename: "BCIL-ticket.png", content: png }] }),
  });
  if (!res.ok) return json({ sent: false, reason: await res.text() }, 502);
  await admin.from("form_responses").update({ ticket_emailed_at: new Date().toISOString() }).eq("id", r.id);
  return json({ sent: true });
});

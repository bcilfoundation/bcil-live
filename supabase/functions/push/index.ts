// BCIL Live: send phone notifications (Web Push) for a new row in public.notifications.
// Called by a database trigger (pg_net) with { id } and the shared x-push-secret header.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

function secretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const o = JSON.parse(raw); const v = Object.values(o)[0]; if (typeof v === "string") return v; } catch { /* fall through */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false } });

  // keys and the shared secret live in the database (private schema), readable only with the secret key
  const { data: cfg, error: cfgErr } = await admin.rpc("push_config");
  const c = Array.isArray(cfg) ? cfg[0] : cfg;
  if (cfgErr || !c) return json({ error: "push not configured" }, 500);
  if (req.headers.get("x-push-secret") !== c.secret) return json({ error: "forbidden" }, 403);

  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return json({ error: "missing id" }, 400);
  const { data: n } = await admin.from("notifications").select("id, user_id, kind, body, link").eq("id", id).single();
  if (!n) return json({ error: "not found" }, 404);
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", n.user_id);
  if (!subs?.length) return json({ sent: 0 });

  webpush.setVapidDetails(c.vapid_subject, c.vapid_public, c.vapid_private);
  const titles: Record<string, string> = { live: "BCIL is live now", message: "New message", friend_request: "Friend request", friend_accepted: "Friend request accepted", activity: "New group activity", post: "Group update" };
  const payload = JSON.stringify({ title: titles[n.kind] ?? "BCIL Live", body: n.body, url: n.link ?? "/", tag: n.kind === "message" ? `msg-${n.link}` : undefined });

  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: n.kind === "live" ? "high" : "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint); // phone unsubscribed
    }
  }));
  return json({ sent });
});

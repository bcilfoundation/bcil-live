// BCIL Live: send phone notifications for a new row in public.notifications:
// Web Push for the website / home-screen app, and Firebase Cloud Messaging (FCM) for the Android app.
// FCM needs the secret FCM_SERVICE_ACCOUNT (the Firebase service account JSON).
// Called by a database trigger (pg_net) with { id } and the shared x-push-secret header.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

function secretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const o = JSON.parse(raw); const v = Object.values(o)[0]; if (typeof v === "string") return v; } catch { /* fall through */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
// ---------- Firebase Cloud Messaging (Android app) ----------
type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let fcmToken: { value: string; exp: number } | null = null;
const b64url = (b: ArrayBuffer | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` }),
  });
  const out = await res.json();
  if (!out.access_token) throw new Error("FCM auth failed");
  fcmToken = { value: out.access_token, exp: Date.now() + (out.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}
/** returns "ok", "gone" (token no longer valid) or "error" */
async function sendFcm(sa: ServiceAccount, token: string, m: { title: string; body: string; url: string; tag?: string; high: boolean }) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await fcmAccessToken(sa)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: {
      token, notification: { title: m.title, body: m.body }, data: { url: m.url },
      android: { priority: m.high ? "HIGH" : "NORMAL", notification: { channel_id: "bcil", icon: "ic_stat_live", color: "#13294b", tag: m.tag } },
    } }),
  });
  if (res.ok) return "ok";
  const err = await res.text();
  return res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(err) ? "gone" : "error";
}

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), { auth: { persistSession: false } });

  // keys and the shared secret live in the database (private schema), readable only with the secret key
  const { data: cfg, error: cfgErr } = await admin.rpc("push_config");
  const c = Array.isArray(cfg) ? cfg[0] : cfg;
  if (cfgErr || !c) return json({ error: "push not configured" }, 500);
  const body = await req.json().catch(() => ({}));

  // first use: create the notification keys here, so the private key never leaves the server
  if (!c.vapid_private) {
    const keys = webpush.generateVAPIDKeys();
    await admin.rpc("push_save_keys", { p_public: keys.publicKey, p_private: keys.privateKey });
    if (body.action === "init") return json({ ok: true, initialised: true });
    c.vapid_public = keys.publicKey; c.vapid_private = keys.privateKey;
  }
  if (body.action === "init") return json({ ok: true });
  if (req.headers.get("x-push-secret") !== c.secret) return json({ error: "forbidden" }, 403);

  const { id } = body;
  if (!id) return json({ error: "missing id" }, 400);
  const { data: n } = await admin.from("notifications").select("id, user_id, kind, body, link").eq("id", id).single();
  if (!n) return json({ error: "not found" }, 404);
  const { data: subs } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", n.user_id);
  if (!subs?.length) return json({ sent: 0 });

  webpush.setVapidDetails(c.vapid_subject, c.vapid_public, c.vapid_private);
  let sa: ServiceAccount | null = null;
  try { const raw = Deno.env.get("FCM_SERVICE_ACCOUNT"); if (raw) sa = JSON.parse(raw); } catch { sa = null; }
  const titles: Record<string, string> = { live: "BCIL is live now", message: "New message", friend_request: "Friend request", friend_accepted: "Friend request accepted", activity: "New group activity", post: "Group update" };
  const payload = JSON.stringify({ title: titles[n.kind] ?? "BCIL Live", body: n.body, url: n.link ?? "/", tag: n.kind === "message" ? `msg-${n.link}` : undefined });

  let sent = 0;
  const msg = JSON.parse(payload) as { title: string; body: string; url: string; tag?: string };
  await Promise.all(subs.map(async (s) => {
    if (s.endpoint.startsWith("fcm:")) {
      if (!sa) return;
      const r = await sendFcm(sa, s.endpoint.slice(4), { ...msg, high: n.kind === "live" }).catch(() => "error");
      if (r === "ok") sent++; else if (r === "gone") await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      return;
    }
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

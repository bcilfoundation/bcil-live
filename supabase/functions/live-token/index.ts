// live-token: gives a signed-in user a short-lived pass (Agora token) for a live session.
// Listeners get an audience pass; hosts/moderators and callers the host brought on air get a speaker pass.
// Deploy: supabase functions deploy live-token
// Secrets: supabase secrets set AGORA_APP_ID=... AGORA_APP_CERTIFICATE=...
import { createClient } from "npm:@supabase/supabase-js@2";
import { RtcRole, RtcTokenBuilder } from "npm:agora-token@2";

// Newer Supabase projects expose keys as JSON lists; older ones as single values.
function publicKey() {
  try { const k = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}"); const v = k.default ?? Object.values(k)[0]; if (v) return String(v); } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_ANON_KEY")!;
}
function secretKey() {
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const v = k.default ?? Object.values(k)[0]; if (v) return String(v); } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { session_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, publicKey(), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Please sign in" }, 401);

    const { data: session } = await supabase.from("live_sessions").select("id, channel, status").eq("id", session_id).single();
    if (!session || session.status !== "live") return json({ error: "This session is not live" }, 400);

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const isHost = profile?.role === "admin" || profile?.role === "moderator";
    const { data: onAir } = await supabase.from("call_requests").select("id")
      .eq("session_id", session_id).eq("user_id", user.id).eq("status", "on_air").maybeSingle();
    const speaker = isHost || !!onAir;

    // Check the Agora settings (values are never returned, only what is wrong with them)
    const appId = (Deno.env.get("AGORA_APP_ID") ?? "").trim();
    const cert = (Deno.env.get("AGORA_APP_CERTIFICATE") ?? "").trim();
    const hex32 = /^[0-9a-f]{32}$/i;
    if (!hex32.test(appId)) return json({ error: `Setup problem: AGORA_APP_ID is not set correctly (expected 32 letters/numbers, found ${appId.length}).` }, 500);
    if (!hex32.test(cert)) return json({ error: `Setup problem: AGORA_APP_CERTIFICATE is not set correctly (expected 32 letters/numbers, found ${cert.length}). Copy the Primary Certificate from Agora again.` }, 500);

    // Agora numeric uid derived from the user id; valid for 2 hours
    const uid = parseInt(user.id.replace(/-/g, "").slice(0, 8), 16) >>> 1;
    const expires = 2 * 60 * 60;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId, cert,
      session.channel, uid, speaker ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER, expires, expires,
    );
    if (!token) return json({ error: "Setup problem: Agora could not create a pass with these settings. Check that the certificate belongs to the bcil-live project." }, 500);
    return json({ token, uid, channel: session.channel, appId, speaker });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

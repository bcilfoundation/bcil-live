// give: starts a payment to BCIL Foundation with Paystack checkout (Mobile Money or card).
// Two kinds: a donation of any amount, or a gift during a live session (fixed prices below).
// All money goes to BCIL Foundation. Under-18s may give with a parent/guardian's knowledge, up to a small daily limit.
// Secrets: PAYSTACK_SECRET_KEY (sk_live_... or sk_test_...)
import { createClient } from "npm:@supabase/supabase-js@2";

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

// Live gift prices in Ghana cedis (keep in step with app/src/lib/pay.ts)
const GIFTS: Record<string, { label: string; cedis: number }> = {
  rose: { label: "🌹 Rose", cedis: 2 }, star: { label: "⭐ Star", cedis: 5 }, gift: { label: "🎁 Gift", cedis: 10 },
  trophy: { label: "🏆 Trophy", cedis: 20 }, crown: { label: "👑 Crown", cedis: 50 },
};
const MINOR_DAILY_PESEWAS = 20 * 100;      // under-18s: GH₵ 20 a day in total
const MAX_PAYMENT_PESEWAS = 10000 * 100;   // one payment: up to GH₵ 10,000
const SITE = "https://live.bcilfoundation.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, publicKey(), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Please sign in" }, 401);
    if (!Deno.env.get("PAYSTACK_SECRET_KEY")) return json({ error: "Giving is not switched on yet." }, 503);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, secretKey());
    const { data: profile } = await admin.from("profiles").select("full_name, is_minor").eq("id", user.id).single();
    const under18 = !!profile?.is_minor || body.adult !== true;
    if (under18 && body.guardian_ok !== true)
      return json({ error: "Please confirm that your parent or guardian knows you are giving." }, 400);

    // what is being paid for
    let pesewas: number, purpose: string, kind: "donation" | "live_gift", giftCode: string | null = null, giftLabel: string | null = null, sessionId: string | null = null;
    if (body.kind === "live_gift") {
      const g = GIFTS[String(body.gift_code)];
      if (!g) return json({ error: "Unknown gift" }, 400);
      const { data: s } = await admin.from("live_sessions").select("id, title, status").eq("id", body.session_id).single();
      if (!s || s.status !== "live") return json({ error: "This session has ended." }, 400);
      kind = "live_gift"; pesewas = g.cedis * 100; giftCode = String(body.gift_code); giftLabel = g.label; sessionId = s.id;
      purpose = `Live gift ${g.label} · ${s.title}`.slice(0, 200);
    } else {
      kind = "donation";
      pesewas = Math.round(Number(body.amount_cedis) * 100);
      purpose = String(body.purpose || "General support").slice(0, 120);
    }
    if (!Number.isFinite(pesewas) || pesewas < 100) return json({ error: "The smallest gift is GH₵ 1." }, 400);
    if (pesewas > MAX_PAYMENT_PESEWAS) return json({ error: "For gifts above GH₵ 10,000, please contact info@bcilfoundation.org." }, 400);

    if (under18) {
      const since = new Date(); since.setUTCHours(0, 0, 0, 0);    // Ghana is on UTC
      const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: today } = await admin.from("gifts").select("amount_pesewas, status, created_at")
        .eq("user_id", user.id).gte("created_at", since.toISOString());
      const used = (today ?? []).filter((g) => g.status === "paid" || (g.status === "pending" && g.created_at >= recent))
        .reduce((n, g) => n + g.amount_pesewas, 0);
      if (used + pesewas > MINOR_DAILY_PESEWAS)
        return json({ error: `Members under 18 can give up to GH₵ 20 a day. You can give GH₵ ${Math.max(0, (MINOR_DAILY_PESEWAS - used) / 100)} more today. Thank you for your kindness!` }, 400);
    }

    const reference = `bcil_${crypto.randomUUID()}`;
    const { error: insErr } = await admin.from("gifts").insert({
      user_id: user.id, amount_pesewas: pesewas, purpose, method: "mobile_money", status: "pending", paystack_reference: reference,
      kind, session_id: sessionId, gift_code: giftCode, gift_label: giftLabel,
      under_18: under18, guardian_ok: under18 && body.guardian_ok === true, anonymous: body.anonymous === true,
    });
    if (insErr) return json({ error: "Could not start the payment. Please try again." }, 500);

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: pesewas, currency: "GHS", reference,
        email: user.email || `${user.id}@members.bcilfoundation.org`,
        channels: ["mobile_money", "card"],
        callback_url: `${SITE}/thanks?kind=${kind}`,
        metadata: { purpose, kind, user_id: user.id, gift: giftLabel, custom_fields: [{ display_name: "For", variable_name: "purpose", value: purpose }] },
      }),
    });
    const out = await res.json();
    if (!out?.status || !out?.data?.authorization_url) {
      await admin.from("gifts").update({ status: "failed" }).eq("paystack_reference", reference);
      return json({ error: out?.message || "Paystack could not start the payment." }, 502);
    }
    return json({ reference, url: out.data.authorization_url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

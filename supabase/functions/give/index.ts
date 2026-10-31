// give: starts a Mobile Money payment with Paystack. The giver gets a prompt on their phone to approve.
// Deploy: supabase functions deploy give
// Secrets: supabase secrets set PAYSTACK_SECRET_KEY=sk_live_...
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
// Paystack's Ghana provider codes
const PROVIDERS: Record<string, string> = { mtn: "mtn", telecel: "vod", at: "atl" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { amount_cedis, purpose, network, phone } = await req.json();
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Please sign in" }, 401);

    const pesewas = Math.round(Number(amount_cedis) * 100);
    if (!Number.isFinite(pesewas) || pesewas < 100) return json({ error: "Enter at least GH₵ 1" }, 400);
    const digits = String(phone).replace(/\D/g, "");
    const local = digits.startsWith("233") ? "0" + digits.slice(3) : digits;
    if (!/^0\d{9}$/.test(local)) return json({ error: "Enter a 10-digit Ghana number" }, 400);
    if (!PROVIDERS[network]) return json({ error: "Choose MTN, Telecel or AT" }, 400);

    const reference = `bcil_${crypto.randomUUID()}`;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("gifts").insert({
      user_id: user.id, amount_pesewas: pesewas, purpose: purpose || "General support",
      method: "mobile_money", status: "pending", paystack_reference: reference,
    });

    const res = await fetch("https://api.paystack.co/charge", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: pesewas, currency: "GHS", reference,
        email: user.email || `${user.id}@members.bcilfoundation.org`,   // Paystack requires an email
        mobile_money: { phone: local, provider: PROVIDERS[network] },
        metadata: { purpose, user_id: user.id },
      }),
    });
    const out = await res.json();
    // Paystack may answer "send_otp" (ask for the code sent by SMS) or "pay_offline" (approve on phone)
    return json({ reference, status: out?.data?.status, message: out?.data?.display_text || out?.message });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

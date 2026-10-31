// paystack-webhook: Paystack calls this when a payment succeeds or fails. It marks the gift paid.
// Deploy without sign-in check: supabase functions deploy paystack-webhook --no-verify-jwt
// Then in Paystack Dashboard > Settings > API Keys & Webhooks, set the webhook URL to:
//   https://<your-project>.supabase.co/functions/v1/paystack-webhook
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  if (!(await validSignature(raw, signature))) return new Response("bad signature", { status: 401 });

  const event = JSON.parse(raw);
  const reference = event?.data?.reference;
  if (!reference) return new Response("ok");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (event.event === "charge.success") {
    await admin.from("gifts").update({ status: "paid" }).eq("paystack_reference", reference);
  } else if (event.event === "charge.failed") {
    await admin.from("gifts").update({ status: "failed" }).eq("paystack_reference", reference);
  }
  return new Response("ok");
});

// Paystack signs each webhook with HMAC-SHA512 of the body using your secret key
async function validSignature(body: string, signature: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(Deno.env.get("PAYSTACK_SECRET_KEY")!),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

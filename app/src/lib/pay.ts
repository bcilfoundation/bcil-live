// Giving to BCIL Foundation through Paystack (Mobile Money or card). All money goes to BCIL.
import { supabase } from "./supabase";
import { isNative } from "./native";

// Switch on once Paystack has approved BCIL's account and the give + paystack-webhook functions have the secret key
export const PAYMENTS_ENABLED = false;
// While Paystack is in test mode, only admins and moderators see paid gifts and Give (fake money, for testing)
export const PAYMENTS_TEST_FOR_STAFF = true;
export const paymentsOn = (isStaff: boolean) => PAYMENTS_ENABLED || (PAYMENTS_TEST_FOR_STAFF && isStaff);
export const TEST_NOTE = "Test mode: no real money is taken. Use Paystack's test card or test Mobile Money.";

// Live gift prices in Ghana cedis (keep in step with supabase/functions/give/index.ts)
export const PAID_GIFTS = [
  { code: "rose", emoji: "🌹", name: "Rose", cedis: 2 },
  { code: "star", emoji: "⭐", name: "Star", cedis: 5 },
  { code: "gift", emoji: "🎁", name: "Gift", cedis: 10 },
  { code: "trophy", emoji: "🏆", name: "Trophy", cedis: 20 },
  { code: "crown", emoji: "👑", name: "Crown", cedis: 50 },
] as const;

export type Giver = { adult: boolean; guardian_ok: boolean };
export type PayRequest =
  | ({ kind: "live_gift"; gift_code: string; session_id: string } & Giver)
  | ({ kind: "donation"; amount_cedis: number; purpose: string; anonymous?: boolean } & Giver);

/**
 * Start a payment and open Paystack's secure page. Call it straight from a tap: on phones a new
 * window can only be opened during the tap, so we open it first and fill in the address after.
 */
export async function startPayment(req: PayRequest): Promise<void> {
  const win = !isNative ? window.open("", "_blank") : null;
  try {
    const { data, error } = await supabase.functions.invoke("give", { body: req });
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
      throw new Error(detail?.error ?? "Payment could not start. Please try again.");
    }
    if (data?.error) throw new Error(data.error);
    if (isNative) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url });
    } else if (win) {
      win.location.href = data.url;
    } else {
      window.location.href = data.url;     // pop-ups blocked: go to Paystack in this tab
    }
  } catch (e) {
    win?.close();
    throw e;
  }
}

// Remember the age answer on this phone for this visit, so people are not asked every time
const KEY = "bcil.giver";
export function savedGiver(): Giver | null {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || "null"); return v && typeof v.adult === "boolean" ? v : null; } catch { return null; }
}
export function saveGiver(g: Giver) { try { sessionStorage.setItem(KEY, JSON.stringify(g)); } catch { /* blocked */ } }
